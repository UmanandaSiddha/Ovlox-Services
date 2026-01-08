import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ExternalProvider, IntegrationAuthType, IntegrationStatus } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { signState, verifyState } from 'src/utils/oauth-state';

@Injectable()
export class DiscordService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly configService: ConfigService,
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

    async fetchGuildChannels(guildId: string) {
        const DISCORD_BOT_TOKEN = this.configService.get<string>('DISCORD_BOT_TOKEN');

        const res = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
            headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
        });

        return res.data.filter((c: any) => c.type === 0);
    }

    async ingestChannelHistory(channelId: string) {
        const DISCORD_BOT_TOKEN = this.configService.get<string>('DISCORD_BOT_TOKEN');

        let before: string | undefined;

        while (true) {
            const res = await axios.get(`https://discord.com/api/v10/channels/${channelId}/messages`, {
                headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
                params: { limit: 100, before }
            });

            const messages = res.data;
            if (!messages.length) break;

            for (const m of messages) {
                // create RawEvent here
            }

            before = messages[messages.length - 1].id;
        }
    }
}