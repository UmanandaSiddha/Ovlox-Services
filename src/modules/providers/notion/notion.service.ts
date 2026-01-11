import { Injectable, HttpException, HttpStatus, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ExternalProvider, IntegrationAuthType, IntegrationStatus, RawEventType } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { decrypt, encrypt } from 'src/utils/encryption';
import { LlmService } from 'src/modules/llm/llm.service';

@Injectable()
export class NotionIntegrationService {
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
                    provider: ExternalProvider.NOTION,
                    providerUserId: String(providerUserId),
                },
            });

            if (!identity) {
                identity = await this.databaseService.identity.create({
                    data: {
                        organizationId,
                        provider: ExternalProvider.NOTION,
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
        const NOTION_CLIENT_ID = this.configService.get<string>('NOTION_CLIENT_ID');
        const API_URL = this.configService.get<string>('API_URL');

        const params = new URLSearchParams({
            client_id: NOTION_CLIENT_ID!,
            redirect_uri: `${API_URL}/api/v1/integrations/notion/callback`,
            response_type: 'code',
            owner: 'user',
            state: orgId,
        });
        return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
    }

    async handleCallback(query: any) {
        const { code, state } = query;
        if (!code) throw new HttpException('Missing code', HttpStatus.BAD_REQUEST);

        const NOTION_CLIENT_ID = this.configService.get<string>('NOTION_CLIENT_ID');
        const NOTION_CLIENT_SECRET = this.configService.get<string>('NOTION_CLIENT_SECRET');
        const API_URL = this.configService.get<string>('API_URL');
        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');

        const tokenRes = await axios.post('https://api.notion.com/v1/oauth/token', {
            grant_type: 'authorization_code',
            code,
            redirect_uri: `${API_URL}/api/v1/integrations/notion/callback`,
        }, {
            auth: { username: NOTION_CLIENT_ID!, password: NOTION_CLIENT_SECRET! }
        });

        const { access_token } = tokenRes.data;

        const integration = await this.databaseService.integration.findFirst({
            where: { organizationId: state, type: ExternalProvider.NOTION }
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
                    type: ExternalProvider.NOTION,
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

    async fetchDatabases(integrationId: string) {
        const token = await this.getValidToken(integrationId);

        const res = await axios.post('https://api.notion.com/v1/search', {
            filter: { property: 'object', value: 'database' },
            page_size: 100,
        }, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Notion-Version': '2022-06-28',
            },
        });

        return res.data.results || [];
    }

    async syncResources(integrationId: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        const databases = await this.fetchDatabases(integrationId);

        for (const db of databases) {
            await this.databaseService.integrationResource.upsert({
                where: {
                    uq_integration_resource_provider: {
                        integrationId: integration.id,
                        provider: ExternalProvider.NOTION,
                        providerId: db.id,
                    },
                },
                update: {
                    name: (db as any).title?.[0]?.plain_text || 'Untitled',
                    url: (db as any).url,
                    metadata: { object: db.object, created_time: db.created_time },
                },
                create: {
                    integrationId: integration.id,
                    provider: ExternalProvider.NOTION,
                    providerId: db.id,
                    name: (db as any).title?.[0]?.plain_text || 'Untitled',
                    url: (db as any).url,
                    metadata: { object: db.object, created_time: db.created_time },
                },
            });
        }

        return { synced: databases.length, databases };
    }

    async ingestPages(integrationId: string, databaseId?: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
            include: { organization: true },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        const token = await this.getValidToken(integrationId);
        let startCursor: string | undefined;
        let pageCount = 0;

        while (true) {
            const query: any = {
                page_size: 100,
            };
            if (startCursor) query.start_cursor = startCursor;
            if (databaseId) query.database_id = databaseId;

            const res = await axios.post('https://api.notion.com/v1/search', query, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Notion-Version': '2022-06-28',
                },
            });

            const pages = res.data.results || [];
            if (pages.length === 0) break;

            // Find projects connected to this integration
            const connections = await this.databaseService.integrationConnection.findMany({
                where: {
                    integrationId: integration.id,
                    ...(databaseId
                        ? {
                              items: {
                                  path: ['databases'],
                                  array_contains: databaseId,
                              },
                          }
                        : {}),
                },
                include: { project: true },
            });

            const projectsToProcess = connections.length > 0 ? connections.map((c) => c.project) : [];

            for (const page of pages) {
                const createdById = (page as any).created_by?.id;
                const { identityId, memberId } = createdById
                    ? await this.resolveAuthorIdentity(integration.organizationId, createdById)
                    : { identityId: null, memberId: null };

                for (const project of projectsToProcess) {
                    if (!project) continue;

                    try {
                        const rawEvent = await this.databaseService.rawEvent.create({
                            data: {
                                integrationId: integration.id,
                                projectId: project.id,
                                resourceId: databaseId,
                                source: ExternalProvider.NOTION,
                                sourceId: page.id,
                                eventType: RawEventType.OTHER,
                                authorIdentityId: identityId,
                                authorMemberId: memberId,
                                timestamp: new Date((page as any).created_time || Date.now()),
                                content: (page as any).properties?.title || 'Untitled',
                                metadata: {
                                    page: {
                                        id: page.id,
                                        url: (page as any).url,
                                        object: page.object,
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
                        console.error(`Failed to create RawEvent for Notion page ${page.id}:`, error);
                    }
                }

                pageCount++;
            }

            if (!res.data.has_more) break;
            startCursor = res.data.next_cursor;
        }

        return { ingested: pageCount };
    }

    async handleWebhook(payload: any) {
        await this.databaseService.webhookEvent.create({
            data: {
                provider: ExternalProvider.NOTION,
                providerEventId: payload.id || Date.now().toString(),
                payload,
            },
        });
    }
}