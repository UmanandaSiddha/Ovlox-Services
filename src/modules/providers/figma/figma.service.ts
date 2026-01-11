import { Injectable, BadRequestException, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ExternalProvider, IntegrationAuthType, IntegrationStatus, RawEventType } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { decrypt, encrypt } from 'src/utils/encryption';
import { LlmService } from 'src/modules/llm/llm.service';

@Injectable()
export class FigmaService {
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
        authorName?: string
    ): Promise<{ identityId: string | null; memberId: string | null }> {
        try {
            let identity = await this.databaseService.identity.findFirst({
                where: {
                    organizationId,
                    provider: ExternalProvider.FIGMA,
                    providerUserId: String(providerUserId),
                },
            });

            if (!identity) {
                identity = await this.databaseService.identity.create({
                    data: {
                        organizationId,
                        provider: ExternalProvider.FIGMA,
                        providerUserId: String(providerUserId),
                        displayName: authorName || undefined,
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

        return decrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, config.token);
    }

    getAuthUrl(orgId: string) {
        const FIGMA_CLIENT_ID = this.configService.get<string>('FIGMA_CLIENT_ID');
        const API_URL = this.configService.get<string>('API_URL');

        const params = new URLSearchParams({
            client_id: FIGMA_CLIENT_ID!,
            redirect_uri: `${API_URL}/api/v1/integrations/figma/callback`,
            scope: 'file_read',
            state: orgId,
            response_type: 'code',
        });
        return `https://www.figma.com/oauth?${params.toString()}`;
    }

    async handleCallback(query: any) {
        const { code, state } = query;
        if (!code) throw new HttpException('Missing code', HttpStatus.BAD_REQUEST);

        const FIGMA_CLIENT_ID = this.configService.get<string>('FIGMA_CLIENT_ID');
        const FIGMA_CLIENT_SECRET = this.configService.get<string>('FIGMA_CLIENT_SECRET');
        const API_URL = this.configService.get<string>('API_URL');
        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');

        const tokenRes = await axios.post('https://www.figma.com/api/oauth/token', {
            client_id: FIGMA_CLIENT_ID!,
            client_secret: FIGMA_CLIENT_SECRET!,
            redirect_uri: `${API_URL}/api/v1/integrations/figma/callback`,
            code,
            grant_type: 'authorization_code',
        });

        const { access_token } = tokenRes.data;

        const integration = await this.databaseService.integration.findFirst({
            where: { organizationId: state, type: ExternalProvider.FIGMA }
        });

        if (integration) {
            await this.databaseService.integration.update({
                where: { id: integration.id },
                data: {
                    status: IntegrationStatus.CONNECTED,
                    config: {
                        token: encrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY!, access_token)
                    }
                }
            });
        } else {
            await this.databaseService.integration.create({
                data: {
                    organizationId: state,
                    type: ExternalProvider.FIGMA,
                    authType: IntegrationAuthType.OAUTH,
                    status: IntegrationStatus.CONNECTED,
                    config: {
                        token: encrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY!, access_token)
                    }
                }
            });
        }

        return true;
    }

    async fetchTeams(integrationId: string) {
        const token = await this.getValidToken(integrationId);

        const res = await axios.get('https://api.figma.com/v1/teams', {
            headers: { 'X-Figma-Token': token },
        });

        return res.data.teams || [];
    }

    async fetchFiles(integrationId: string, teamId?: string) {
        const token = await this.getValidToken(integrationId);

        if (teamId) {
            const res = await axios.get(`https://api.figma.com/v1/teams/${teamId}/projects`, {
                headers: { 'X-Figma-Token': token },
            });

            const projects = res.data.projects || [];
            const allFiles: any[] = [];

            for (const project of projects) {
                const filesRes = await axios.get(`https://api.figma.com/v1/projects/${project.id}/files`, {
                    headers: { 'X-Figma-Token': token },
                });
                allFiles.push(...(filesRes.data.files || []));
            }

            return allFiles;
        }

        const teams = await this.fetchTeams(integrationId);
        const allFiles: any[] = [];

        for (const team of teams) {
            const projectsRes = await axios.get(`https://api.figma.com/v1/teams/${team.id}/projects`, {
                headers: { 'X-Figma-Token': token },
            });

            for (const project of projectsRes.data.projects || []) {
                const filesRes = await axios.get(`https://api.figma.com/v1/projects/${project.id}/files`, {
                    headers: { 'X-Figma-Token': token },
                });
                allFiles.push(...(filesRes.data.files || []));
            }
        }

        return allFiles;
    }

    async syncResources(integrationId: string, teamId?: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        const files = await this.fetchFiles(integrationId, teamId);

        for (const file of files) {
            await this.databaseService.integrationResource.upsert({
                where: {
                    uq_integration_resource_provider: {
                        integrationId: integration.id,
                        provider: ExternalProvider.FIGMA,
                        providerId: file.key,
                    },
                },
                update: {
                    name: file.name,
                    url: `https://www.figma.com/file/${file.key}`,
                    metadata: { last_modified: file.last_modified },
                },
                create: {
                    integrationId: integration.id,
                    provider: ExternalProvider.FIGMA,
                    providerId: file.key,
                    name: file.name,
                    url: `https://www.figma.com/file/${file.key}`,
                    metadata: { last_modified: file.last_modified },
                },
            });
        }

        return { synced: files.length, files };
    }

    async ingestFiles(integrationId: string, fileKey?: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
            include: { organization: true },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        const token = await this.getValidToken(integrationId);
        const files = fileKey ? [{ key: fileKey }] : await this.fetchFiles(integrationId);

        let eventCount = 0;

        for (const file of files) {
            // Get file metadata
            const fileRes = await axios.get(`https://api.figma.com/v1/files/${file.key}`, {
                headers: { 'X-Figma-Token': token },
            });

            const fileData = fileRes.data;
            const resource = await this.databaseService.integrationResource.findFirst({
                where: {
                    integrationId: integration.id,
                    provider: ExternalProvider.FIGMA,
                    providerId: file.key,
                },
            });

            // Find projects connected to this file
            const connections = await this.databaseService.integrationConnection.findMany({
                where: {
                    integrationId: integration.id,
                    ...(file.key
                        ? {
                              items: {
                                  path: ['files'],
                                  array_contains: file.key,
                              },
                          }
                        : {}),
                },
                include: { project: true },
            });

            const projectsToProcess = connections.length > 0 ? connections.map((c) => c.project) : [];

            const { identityId, memberId } = fileData.lastModifiedBy?.id
                ? await this.resolveAuthorIdentity(integration.organizationId, fileData.lastModifiedBy.id, fileData.lastModifiedBy.handle)
                : { identityId: null, memberId: null };

            for (const project of projectsToProcess) {
                if (!project) continue;

                try {
                    const rawEvent = await this.databaseService.rawEvent.create({
                        data: {
                            integrationId: integration.id,
                            projectId: project.id,
                            resourceId: resource?.providerId || file.key,
                            source: ExternalProvider.FIGMA,
                            sourceId: file.key,
                            eventType: RawEventType.OTHER,
                            authorIdentityId: identityId,
                            authorMemberId: memberId,
                            authorName: fileData.lastModifiedBy?.handle,
                            timestamp: new Date(fileData.lastModified || Date.now()),
                            content: `File update: ${fileData.name}`,
                            metadata: {
                                file: {
                                    key: file.key,
                                    name: fileData.name,
                                    last_modified: fileData.lastModified,
                                    version: fileData.version,
                                },
                            },
                        },
                    });

                    try {
                        await this.llmService.processRawEvent(rawEvent.id);
                    } catch (error) {
                        console.error(`Failed to process RawEvent ${rawEvent.id}:`, error);
                    }

                    eventCount++;
                } catch (error) {
                    console.error(`Failed to create RawEvent for Figma file ${file.key}:`, error);
                }
            }
        }

        return { ingested: eventCount };
    }

    async ingestComments(integrationId: string, fileKey: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
            include: { organization: true },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        const token = await this.getValidToken(integrationId);

        const res = await axios.get(`https://api.figma.com/v1/files/${fileKey}/comments`, {
            headers: { 'X-Figma-Token': token },
        });

        const comments = res.data.comments || [];
        const resource = await this.databaseService.integrationResource.findFirst({
            where: {
                integrationId: integration.id,
                provider: ExternalProvider.FIGMA,
                providerId: fileKey,
            },
        });

        const connections = await this.databaseService.integrationConnection.findMany({
            where: {
                integrationId: integration.id,
                items: {
                    path: ['files'],
                    array_contains: fileKey,
                },
            },
            include: { project: true },
        });

        const projectsToProcess = connections.length > 0 ? connections.map((c) => c.project) : [];
        let eventCount = 0;

        for (const comment of comments) {
            const { identityId, memberId } = comment.user?.id
                ? await this.resolveAuthorIdentity(integration.organizationId, comment.user.id, comment.user.handle)
                : { identityId: null, memberId: null };

            for (const project of projectsToProcess) {
                if (!project) continue;

                try {
                    const rawEvent = await this.databaseService.rawEvent.create({
                        data: {
                            integrationId: integration.id,
                            projectId: project.id,
                            resourceId: resource?.providerId || fileKey,
                            source: ExternalProvider.FIGMA,
                            sourceId: comment.id,
                            eventType: RawEventType.MESSAGE,
                            authorIdentityId: identityId,
                            authorMemberId: memberId,
                            authorName: comment.user?.handle,
                            timestamp: new Date(comment.created_at || Date.now()),
                            content: comment.message,
                            metadata: {
                                comment: {
                                    id: comment.id,
                                    file_key: fileKey,
                                    parent_id: comment.parent_id,
                                },
                            },
                        },
                    });

                    try {
                        await this.llmService.processRawEvent(rawEvent.id);
                    } catch (error) {
                        console.error(`Failed to process RawEvent ${rawEvent.id}:`, error);
                    }

                    eventCount++;
                } catch (error) {
                    console.error(`Failed to create RawEvent for Figma comment ${comment.id}:`, error);
                }
            }
        }

        return { ingested: eventCount };
    }

    async ingestVersions(integrationId: string, fileKey: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
            include: { organization: true },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        const token = await this.getValidToken(integrationId);

        const res = await axios.get(`https://api.figma.com/v1/files/${fileKey}/versions`, {
            headers: { 'X-Figma-Token': token },
        });

        const versions = res.data.versions || [];
        const resource = await this.databaseService.integrationResource.findFirst({
            where: {
                integrationId: integration.id,
                provider: ExternalProvider.FIGMA,
                providerId: fileKey,
            },
        });

        const connections = await this.databaseService.integrationConnection.findMany({
            where: {
                integrationId: integration.id,
                items: {
                    path: ['files'],
                    array_contains: fileKey,
                },
            },
            include: { project: true },
        });

        const projectsToProcess = connections.length > 0 ? connections.map((c) => c.project) : [];
        let eventCount = 0;

        for (const version of versions) {
            const { identityId, memberId } = version.user?.id
                ? await this.resolveAuthorIdentity(integration.organizationId, version.user.id, version.user.handle)
                : { identityId: null, memberId: null };

            for (const project of projectsToProcess) {
                if (!project) continue;

                try {
                    const rawEvent = await this.databaseService.rawEvent.create({
                        data: {
                            integrationId: integration.id,
                            projectId: project.id,
                            resourceId: resource?.providerId || fileKey,
                            source: ExternalProvider.FIGMA,
                            sourceId: version.id,
                            eventType: RawEventType.OTHER,
                            authorIdentityId: identityId,
                            authorMemberId: memberId,
                            authorName: version.user?.handle,
                            timestamp: new Date(version.created_at || Date.now()),
                            content: `Version ${version.label || version.id} created`,
                            metadata: {
                                version: {
                                    id: version.id,
                                    label: version.label,
                                    description: version.description,
                                    file_key: fileKey,
                                },
                            },
                        },
                    });

                    try {
                        await this.llmService.processRawEvent(rawEvent.id);
                    } catch (error) {
                        console.error(`Failed to process RawEvent ${rawEvent.id}:`, error);
                    }

                    eventCount++;
                } catch (error) {
                    console.error(`Failed to create RawEvent for Figma version ${version.id}:`, error);
                }
            }
        }

        return { ingested: eventCount };
    }

    async handleWebhook(payload: any) {
        await this.databaseService.webhookEvent.create({
            data: {
                provider: ExternalProvider.FIGMA,
                providerEventId: payload.event_id || payload.file_key || Date.now().toString(),
                payload,
            },
        });
    }
}
