import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ExternalProvider, IntegrationAuthType, IntegrationStatus, RawEventType } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { decrypt, encrypt } from 'src/utils/encryption';
import { signState, verifyState } from 'src/utils/oauth-state';
import { LlmService } from 'src/modules/llm/llm.service';

@Injectable()
export class SlackService {
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
                    provider: ExternalProvider.SLACK,
                    providerUserId: String(providerUserId),
                },
            });

            if (!identity) {
                identity = await this.databaseService.identity.create({
                    data: {
                        organizationId,
                        provider: ExternalProvider.SLACK,
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

    getAuthUrl(orgId: string, integrationId: string) {
        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');
        const SLACK_CLIENT_ID = this.configService.get<string>('SLACK_CLIENT_ID');
        const API_URL = this.configService.get<string>('API_URL');

        const state = signState(
            INTEGRATION_TOKEN_ENCRYPTION_KEY!,
            JSON.stringify({ orgId, integrationId, ts: Date.now() })
        );

        const params = new URLSearchParams({
            client_id: SLACK_CLIENT_ID!,
            scope: 'channels:read,channels:history,groups:read,groups:history,conversations:read,users:read',
            redirect_uri: `${API_URL}/api/v1/integrations/slack/callback`,
            state,
        });

        return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
    }

    async handleCallback(query: any) {
        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');
        const SLACK_CLIENT_ID = this.configService.get<string>('SLACK_CLIENT_ID');
        const SLACK_CLIENT_SECRET = this.configService.get<string>('SLACK_CLIENT_SECRET');
        const API_URL = this.configService.get<string>('API_URL');

        const { code, state } = query;
        if (!code || !state) throw new BadRequestException('Invalid callback');

        const payload = verifyState(INTEGRATION_TOKEN_ENCRYPTION_KEY!, state);
        if (!payload) throw new BadRequestException('Invalid or expired state');

        const { orgId, integrationId } = JSON.parse(payload);

        const res = await axios.post('https://slack.com/api/oauth.v2.access', null, {
            params: {
                client_id: SLACK_CLIENT_ID!,
                client_secret: SLACK_CLIENT_SECRET!,
                code,
                redirect_uri: `${API_URL}/api/v1/integrations/slack/callback`,
            },
        });

        if (!res.data.ok) throw new BadRequestException(res.data.error || 'Slack OAuth failed');

        const botToken = res.data.access_token;
        const team = res.data.team;

        await this.databaseService.integration.update({
            where: { id: integrationId },
            data: {
                type: ExternalProvider.SLACK,
                authType: IntegrationAuthType.OAUTH,
                status: IntegrationStatus.CONNECTED,
                config: {
                    teamId: team.id,
                    teamName: team.name,
                    botUserId: res.data.bot_user_id,
                    token: encrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY!, botToken)
                }
            }
        });

        return true;
    }

    async fetchSlackChannels(integrationId: string) {
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

        const token = decrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, config.token);
        let cursor: string | undefined;
        const channels: any[] = [];

        do {
            const res = await axios.get('https://slack.com/api/conversations.list', {
                headers: { Authorization: `Bearer ${token}` },
                params: { limit: 200, cursor }
            });

            if (!res.data.ok) throw new Error(res.data.error);

            channels.push(...res.data.channels);
            cursor = res.data.response_metadata?.next_cursor || undefined;
        } while (cursor);

        return channels;
    }

    async syncChannels(integrationId: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        const channels = await this.fetchSlackChannels(integrationId);

        for (const channel of channels) {
            await this.databaseService.integrationResource.upsert({
                where: {
                    uq_integration_resource_provider: {
                        integrationId: integration.id,
                        provider: ExternalProvider.SLACK,
                        providerId: channel.id,
                    },
                },
                update: {
                    name: channel.name,
                    metadata: { is_private: channel.is_private, is_archived: channel.is_archived },
                },
                create: {
                    integrationId: integration.id,
                    provider: ExternalProvider.SLACK,
                    providerId: channel.id,
                    name: channel.name,
                    metadata: { is_private: channel.is_private, is_archived: channel.is_archived },
                },
            });
        }

        return { synced: channels.length, channels };
    }

    async ingestSlackHistory(integrationId: string, channelId: string, projectId?: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
            include: { organization: true },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        const config = integration.config as any;
        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');

        if (!config?.token || !INTEGRATION_TOKEN_ENCRYPTION_KEY) {
            throw new BadRequestException('Integration not properly configured');
        }

        const token = decrypt(INTEGRATION_TOKEN_ENCRYPTION_KEY, config.token);
        const resource = await this.databaseService.integrationResource.findFirst({
            where: {
                integrationId: integration.id,
                provider: ExternalProvider.SLACK,
                providerId: channelId,
            },
        });

        // Find projects connected to this channel
        const connections = projectId
            ? await this.databaseService.integrationConnection.findMany({
                  where: {
                      integrationId: integration.id,
                      projectId,
                      items: {
                          path: ['channels'],
                          array_contains: channelId,
                      },
                  },
                  include: { project: true },
              })
            : await this.databaseService.integrationConnection.findMany({
                  where: {
                      integrationId: integration.id,
                      items: {
                          path: ['channels'],
                          array_contains: channelId,
                      },
                  },
                  include: { project: true },
              });

        const projectsToProcess = connections.length > 0 ? connections.map((c) => c.project) : projectId ? [await this.databaseService.project.findUnique({ where: { id: projectId } })] : [];

        let cursor: string | undefined;
        let messageCount = 0;

        do {
            const res = await axios.get('https://slack.com/api/conversations.history', {
                headers: { Authorization: `Bearer ${token}` },
                params: { channel: channelId, limit: 200, cursor }
            });

            if (!res.data.ok) throw new Error(res.data.error);

            for (const msg of res.data.messages) {
                if (msg.subtype || msg.bot_id) continue;

                // Resolve author identity
                const authorId = msg.user;
                const { identityId, memberId } = authorId
                    ? await this.resolveAuthorIdentity(integration.organizationId, authorId, msg.username)
                    : { identityId: null, memberId: null };

                // Create RawEvent for each connected project
                for (const project of projectsToProcess) {
                    if (!project) continue;

                    try {
                        const rawEvent = await this.databaseService.rawEvent.create({
                            data: {
                                integrationId: integration.id,
                                projectId: project.id,
                                resourceId: resource?.providerId || channelId,
                                source: ExternalProvider.SLACK,
                                sourceId: msg.ts,
                                eventType: RawEventType.MESSAGE,
                                authorIdentityId: identityId,
                                authorMemberId: memberId,
                                authorName: msg.username,
                                channelId: channelId,
                                channelName: resource?.name,
                                timestamp: new Date(parseFloat(msg.ts) * 1000),
                                content: msg.text,
                                metadata: {
                                    channel: { id: channelId, name: resource?.name },
                                    message: {
                                        type: msg.type,
                                        edited: msg.edited ? { ts: msg.edited.ts } : null,
                                        files: msg.files?.length || 0,
                                    },
                                },
                            },
                        });

                        // Queue LLM processing
                        try {
                            await this.llmService.processRawEvent(rawEvent.id);
                        } catch (error) {
                            console.error(`Failed to process RawEvent ${rawEvent.id}:`, error);
                        }
                    } catch (error) {
                        console.error(`Failed to create RawEvent for Slack message ${msg.ts}:`, error);
                    }
                }

                messageCount++;
            }

            cursor = res.data.response_metadata?.next_cursor || undefined;
        } while (cursor);

        return { ingested: messageCount };
    }

    async handleWebhook(payload: any) {
        await this.databaseService.webhookEvent.create({
            data: {
                provider: ExternalProvider.SLACK,
                providerEventId: payload.event?.event_ts || Date.now().toString(),
                payload,
            },
        });
    }
}