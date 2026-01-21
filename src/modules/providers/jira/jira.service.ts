import { Injectable, HttpException, HttpStatus, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ExternalProvider, IntegrationAuthType, IntegrationStatus, RawEventType } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { decrypt, encrypt } from 'src/utils/encryption';
import { signState, verifyState } from 'src/utils/oauth-state';
import { LlmService } from 'src/modules/llm/llm.service';

@Injectable()
export class JiraIntegrationService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly configService: ConfigService,
        private readonly llmService: LlmService,
    ) { }

    /**
     * Helper method to resolve identity and map to OrganizationMember
     */
    private async resolveAuthorIdentity(
        organizationId: string,
        providerUserId: string,
        authorName?: string,
        authorEmail?: string
    ): Promise<{ identityId: string | null; memberId: string | null }> {
        try {
            let identity = await this.databaseService.identity.findFirst({
                where: {
                    organizationId,
                    provider: ExternalProvider.JIRA,
                    providerUserId: String(providerUserId),
                },
            });

            if (!identity) {
                identity = await this.databaseService.identity.create({
                    data: {
                        organizationId,
                        provider: ExternalProvider.JIRA,
                        providerUserId: String(providerUserId),
                        displayName: authorName || undefined,
                        rawProfile: { email: authorEmail || undefined },
                    },
                });
            }

            const contributorMap = await this.databaseService.contributorMap.findUnique({
                where: {
                    uq_contributor_map_org_identity: {
                        organizationId,
                        identityId: identity.id,
                    },
                },
            });

            return {
                identityId: identity.id,
                memberId: contributorMap?.memberId || null,
            };
        } catch (error) {
            return { identityId: null, memberId: null };
        }
    }

    async getValidToken(integrationId: string): Promise<string> {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        const config = integration.config as any;
        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');

        if (!config?.token || !INTEGRATION_TOKEN_ENCRYPTION_KEY) {
            throw new BadRequestException('Integration not properly configured');
        }

        // Check if token is expired
        const expiresAt = config.expiresAt ? new Date(config.expiresAt) : null;
        if (expiresAt && expiresAt.getTime() > Date.now() - 60000) {
            // Token is still valid (with 1 minute buffer)
            return decrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, config.token);
        }

        // Token expired, refresh it
        if (config.refreshToken) {
            try {
                const JIRA_CLIENT_ID = this.configService.get<string>('JIRA_CLIENT_ID');
                const JIRA_CLIENT_SECRET = this.configService.get<string>('JIRA_CLIENT_SECRET');

                const refreshRes = await axios.post('https://auth.atlassian.com/oauth/token', {
                    grant_type: 'refresh_token',
                    client_id: JIRA_CLIENT_ID,
                    client_secret: JIRA_CLIENT_SECRET,
                    refresh_token: decrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, config.refreshToken),
                });

                const { access_token, refresh_token, expires_in } = refreshRes.data;

                await this.databaseService.integration.update({
                    where: { id: integrationId },
                    data: {
                        config: {
                            ...config,
                            token: encrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, access_token),
                            refreshToken: refresh_token ? encrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, refresh_token) : config.refreshToken,
                            expiresAt: new Date(Date.now() + expires_in * 1000).toISOString(),
                        },
                    },
                });

                return access_token;
            } catch (error) {
                throw new BadRequestException('Token refresh failed');
            }
        }

        return decrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, config.token);
    }

    getAuthUrl(orgId: string, integrationId: string) {
        const JIRA_CLIENT_ID = this.configService.get<string>('JIRA_CLIENT_ID');
        const API_URL = this.configService.get<string>('API_URL');
        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');

        if (!JIRA_CLIENT_ID || !API_URL || !INTEGRATION_TOKEN_ENCRYPTION_KEY) {
            throw new BadRequestException('Jira configuration missing');
        }

        const state = signState(
            INTEGRATION_TOKEN_ENCRYPTION_KEY,
            JSON.stringify({ orgId, integrationId, ts: Date.now() }),
        );

        const params = new URLSearchParams({
            audience: 'api.atlassian.com',
            client_id: JIRA_CLIENT_ID,
            scope: 'read:jira-work write:jira-work',
            redirect_uri: `${API_URL}/api/v1/integrations/jira/callback`,
            state,
            response_type: 'code',
        });

        return `https://auth.atlassian.com/authorize?${params.toString()}`;
    }

    async handleCallback(query: any) {
        const { code, state } = query;
        if (!code) throw new HttpException('Missing code', HttpStatus.BAD_REQUEST);

        const JIRA_CLIENT_ID = this.configService.get<string>('JIRA_CLIENT_ID');
        const JIRA_CLIENT_SECRET = this.configService.get<string>('JIRA_CLIENT_SECRET');
        const API_URL = this.configService.get<string>('API_URL');
        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');

        if (!INTEGRATION_TOKEN_ENCRYPTION_KEY || !JIRA_CLIENT_ID || !JIRA_CLIENT_SECRET || !API_URL) {
            throw new BadRequestException('Jira configuration missing');
        }

        const payload = verifyState(INTEGRATION_TOKEN_ENCRYPTION_KEY, state || '');
        if (!payload) throw new BadRequestException('Invalid or expired state');

        const { orgId, integrationId } = JSON.parse(payload);

        const tokenRes = await axios.post('https://auth.atlassian.com/oauth/token', {
            grant_type: 'authorization_code',
            client_id: JIRA_CLIENT_ID,
            client_secret: JIRA_CLIENT_SECRET,
            code,
            redirect_uri: `${API_URL}/api/v1/integrations/jira/callback`,
        });

        const { access_token, refresh_token, expires_in } = tokenRes.data;

        // Fetch accessible resources to capture cloud/site identity
        const cloudRes = await axios.get('https://api.atlassian.com/oauth/token/accessible-resources', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const firstCloud = Array.isArray(cloudRes.data) && cloudRes.data.length > 0 ? cloudRes.data[0] : null;

        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
        });

        const cloudMetadata = firstCloud
            ? {
                cloudId: firstCloud.id,
                cloudName: firstCloud.name,
                cloudUrl: firstCloud.url,
                scopes: firstCloud.scopes,
            }
            : {};

        if (integration) {
            await this.databaseService.integration.update({
                where: { id: integrationId },
                data: {
                    organizationId: integration.organizationId || orgId,
                    status: IntegrationStatus.CONNECTED,
                    authType: IntegrationAuthType.OAUTH,
                    config: {
                        ...(integration.config as any),
                        ...cloudMetadata,
                        token: encrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, access_token),
                        refreshToken: encrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, refresh_token),
                        expiresAt: new Date(Date.now() + expires_in * 1000).toISOString(),
                        connectedAt: new Date().toISOString(),
                    },
                },
            });
        } else {
            await this.databaseService.integration.create({
                data: {
                    id: integrationId,
                    organizationId: orgId,
                    type: ExternalProvider.JIRA,
                    authType: IntegrationAuthType.OAUTH,
                    status: IntegrationStatus.CONNECTED,
                    config: {
                        ...cloudMetadata,
                        token: encrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, access_token),
                        refreshToken: encrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, refresh_token),
                        expiresAt: new Date(Date.now() + expires_in * 1000).toISOString(),
                        connectedAt: new Date().toISOString(),
                    },
                },
            });
        }

        return true;
    }

    async fetchProjects(integrationId: string) {
        const token = await this.getValidToken(integrationId);
        const integration = await this.databaseService.integration.findUnique({ where: { id: integrationId } });
        const config = integration?.config as any;
        let cloudId = config?.cloudId;

        if (!cloudId) {
            // Get cloud ID first
            const cloudRes = await axios.get('https://api.atlassian.com/oauth/token/accessible-resources', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!cloudRes.data || cloudRes.data.length === 0) {
                throw new BadRequestException('No accessible Jira resources found');
            }
            // Use first cloud ID
            const firstCloud = cloudRes.data[0];
            await this.databaseService.integration.update({
                where: { id: integrationId },
                data: {
                    config: {
                        ...config,
                        cloudId: firstCloud.id,
                    },
                },
            });
            return this.fetchProjects(integrationId); // Retry with cloud ID
        }

        const res = await axios.get(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        return res.data;
    }

    async syncProjects(integrationId: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        const projects = await this.fetchProjects(integrationId);

        for (const project of projects) {
            await this.databaseService.integrationResource.upsert({
                where: {
                    uq_integration_resource_provider: {
                        integrationId: integration.id,
                        provider: ExternalProvider.JIRA,
                        providerId: project.key,
                    },
                },
                update: {
                    name: project.name,
                    url: project.url,
                    metadata: { id: project.id, key: project.key },
                },
                create: {
                    integrationId: integration.id,
                    provider: ExternalProvider.JIRA,
                    providerId: project.key,
                    name: project.name,
                    url: project.url,
                    metadata: { id: project.id, key: project.key },
                },
            });
        }

        return { synced: projects.length, projects };
    }

    async ingestIssues(integrationId: string, projectKey?: string, jql?: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
            include: { organization: true },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        const token = await this.getValidToken(integrationId);
        const config = integration.config as any;
        const cloudId = config.cloudId;

        if (!cloudId) {
            throw new BadRequestException('Cloud ID not found');
        }

        const baseJQL = jql || (projectKey ? `project = ${projectKey}` : '');
        let startAt = 0;
        const maxResults = 100;
        let issueCount = 0;

        while (true) {
            const res = await axios.get(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search`, {
                headers: { Authorization: `Bearer ${token}` },
                params: {
                    jql: baseJQL,
                    startAt,
                    maxResults,
                    fields: 'summary,description,status,assignee,reporter,created,updated,comment',
                },
            });

            const issues = res.data.issues || [];
            if (issues.length === 0) break;

            // Find projects connected to this integration
            const connections = await this.databaseService.integrationConnection.findMany({
                where: {
                    integrationId: integration.id,
                    ...(projectKey
                        ? {
                              items: {
                                  path: ['projects'],
                                  array_contains: projectKey,
                              },
                          }
                        : {}),
                },
                include: { project: true },
            });

            const projectsToProcess = connections.length > 0 ? connections.map((c) => c.project) : [];

            for (const issue of issues) {
                const reporterId = issue.fields.reporter?.accountId;
                const { identityId, memberId } = reporterId
                    ? await this.resolveAuthorIdentity(integration.organizationId, reporterId, issue.fields.reporter?.displayName, issue.fields.reporter?.emailAddress)
                    : { identityId: null, memberId: null };

                for (const project of projectsToProcess) {
                    if (!project) continue;

                    try {
                        const rawEvent = await this.databaseService.rawEvent.create({
                            data: {
                                integrationId: integration.id,
                                projectId: project.id,
                                resourceId: issue.fields.project?.key,
                                source: ExternalProvider.JIRA,
                                sourceId: issue.key,
                                eventType: RawEventType.TASK_UPDATE,
                                authorIdentityId: identityId,
                                authorMemberId: memberId,
                                authorName: issue.fields.reporter?.displayName,
                                authorEmail: issue.fields.reporter?.emailAddress,
                                timestamp: new Date(issue.fields.created || Date.now()),
                                content: issue.fields.summary,
                                metadata: {
                                    issue: {
                                        key: issue.key,
                                        summary: issue.fields.summary,
                                        status: issue.fields.status?.name,
                                        assignee: issue.fields.assignee?.displayName,
                                        description: issue.fields.description,
                                    },
                                },
                            },
                        });

                        try {
                            await this.llmService.processRawEvent(rawEvent.id);
                        } catch (error) {
                            console.error(`Failed to process RawEvent ${rawEvent.id}:`, error);
                        }
                    } catch (error) {
                        console.error(`Failed to create RawEvent for Jira issue ${issue.key}:`, error);
                    }
                }

                issueCount++;
            }

            if (issues.length < maxResults) break;
            startAt += maxResults;
        }

        return { ingested: issueCount };
    }

    async handleWebhook(payload: any) {
        // Jira webhook signature verification (JWT-based)
        await this.databaseService.webhookEvent.create({
            data: {
                provider: ExternalProvider.JIRA,
                providerEventId: payload.issue?.key || payload.webhookEvent || Date.now().toString(),
                payload,
            },
        });
    }
}