import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ExternalProvider, IntegrationAuthType, IntegrationStatus, RawEventType } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { signState, verifyState } from 'src/utils/oauth-state';
import { LlmService } from 'src/modules/llm/llm.service';

@Injectable()
export class DiscordService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly configService: ConfigService,
        private readonly llmService: LlmService,
    ) { }

    getInstallUrl(orgId: string, integrationId: string) {
        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');
        const DISCORD_CLIENT_ID = this.configService.get<string>('DISCORD_CLIENT_ID');
        const DISCORD_BOT_PERMISSIONS = this.configService.get<string>('DISCORD_BOT_PERMISSIONS');
        const API_URL = this.configService.get<string>('API_URL');

        const state = signState(
            INTEGRATION_TOKEN_ENCRYPTION_KEY,
            JSON.stringify({
                orgId,
                integrationId,
                ts: Date.now()
            })
        );

        const params = new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            scope: 'bot',
            permissions: DISCORD_BOT_PERMISSIONS || '68608',
            redirect_uri: `${API_URL}/api/v1/integrations/discord/callback`,
            state,
        });

        return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
    }

    async handleCallback(query: any) {
        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');

        const { guild_id, state } = query;
        if (!guild_id || !state) throw new BadRequestException('Invalid callback');

        const payload = verifyState(INTEGRATION_TOKEN_ENCRYPTION_KEY, state);
        if (!payload) throw new BadRequestException('Invalid state');

        const { orgId, integrationId } = JSON.parse(payload);

        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId }
        });
        const config = (integration?.config as any) || {};

        await this.databaseService.integration.update({
            where: { id: integrationId },
            data: {
                type: ExternalProvider.DISCORD,
                authType: IntegrationAuthType.OAUTH,
                status: IntegrationStatus.CONNECTED,
                config: {
                    ...config,
                    guilds: Array.from(new Set([...(config.guilds || []), guild_id]))
                }
            }
        });

        return true;
    }

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
                    provider: ExternalProvider.DISCORD,
                    providerUserId: String(providerUserId),
                },
            });

            if (!identity) {
                identity = await this.databaseService.identity.create({
                    data: {
                        organizationId,
                        provider: ExternalProvider.DISCORD,
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

    async fetchGuildChannels(guildId: string) {
        const DISCORD_BOT_TOKEN = this.configService.get<string>('DISCORD_BOT_TOKEN');

        const res = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
            headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
        });

        return res.data.filter((c: any) => c.type === 0);
    }

    async syncChannels(integrationId: string, guildId: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        const channels = await this.fetchGuildChannels(guildId);

        for (const channel of channels) {
            await this.databaseService.integrationResource.upsert({
                where: {
                    uq_integration_resource_provider: {
                        integrationId: integration.id,
                        provider: ExternalProvider.DISCORD,
                        providerId: channel.id,
                    },
                },
                update: {
                    name: channel.name,
                    metadata: { type: channel.type, guildId },
                },
                create: {
                    integrationId: integration.id,
                    provider: ExternalProvider.DISCORD,
                    providerId: channel.id,
                    name: channel.name,
                    metadata: { type: channel.type, guildId },
                },
            });
        }

        return { synced: channels.length, channels };
    }

    async ingestChannelHistory(integrationId: string, channelId: string, projectId?: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
            include: { organization: true },
        });

        if (!integration) {
            throw new NotFoundException(`Integration ${integrationId} not found`);
        }

        const DISCORD_BOT_TOKEN = this.configService.get<string>('DISCORD_BOT_TOKEN');
        const resource = await this.databaseService.integrationResource.findFirst({
            where: {
                integrationId: integration.id,
                provider: ExternalProvider.DISCORD,
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

        let before: string | undefined;
        let messageCount = 0;

        while (true) {
            const res = await axios.get(`https://discord.com/api/v10/channels/${channelId}/messages`, {
                headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
                params: { limit: 100, before }
            });

            const messages = res.data;
            if (!messages.length) break;

            for (const m of messages) {
                if (m.author?.bot) continue;

                // Resolve author identity
                const authorId = m.author?.id;
                const { identityId, memberId } = authorId
                    ? await this.resolveAuthorIdentity(integration.organizationId, authorId, m.author?.username)
                    : { identityId: null, memberId: null };

                // Create RawEvent for each connected project
                for (const project of projectsToProcess) {
                    if (!project) continue;

                    const rawEvent = await this.databaseService.rawEvent.create({
                        data: {
                            integrationId: integration.id,
                            projectId: project.id,
                            resourceId: resource?.providerId || channelId,
                            source: ExternalProvider.DISCORD,
                            sourceId: m.id,
                            eventType: RawEventType.MESSAGE,
                            authorIdentityId: identityId,
                            authorMemberId: memberId,
                            authorName: m.author?.username,
                            channelId: channelId,
                            channelName: resource?.name,
                            timestamp: new Date(m.timestamp),
                            content: m.content,
                            metadata: {
                                channel: { id: channelId, name: resource?.name },
                                message: {
                                    type: m.type,
                                    edited_timestamp: m.edited_timestamp,
                                    attachments: m.attachments?.length || 0,
                                    embeds: m.embeds?.length || 0,
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
                }

                messageCount++;
            }

            before = messages[messages.length - 1].id;
        }

        return { ingested: messageCount };
    }

    async handleWebhook(payload: any) {
        // Discord webhook handling - Gateway Worker handles real-time events
        // This method can handle webhook events if Discord sends them
        await this.databaseService.webhookEvent.create({
            data: {
                provider: ExternalProvider.DISCORD,
                providerEventId: payload.id || Date.now().toString(),
                payload,
            },
        });
    }
}