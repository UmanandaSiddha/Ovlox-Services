import { Injectable, BadRequestException } from '@nestjs/common';
import { ExternalProvider } from '@prisma/client';
import axios from 'axios';
import { IntegrationAuthType, IntegrationStatus } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { decrypt, encrypt } from 'src/utils/encryption';
import { signState, verifyState } from 'src/utils/oauth-state';

@Injectable()
export class SlackService {
    constructor(private readonly databaseService: DatabaseService) { }

    getAuthUrl(orgId: string, integrationId: string) {
        const state = signState(
            process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY!,
            JSON.stringify({ orgId, integrationId, ts: Date.now() })
        );

        const params = new URLSearchParams({
            client_id: process.env.SLACK_CLIENT_ID!,
            scope: 'channels:read,channels:history,groups:read,groups:history,conversations:read,users:read',
            redirect_uri: `${process.env.API_URL}/api/v1/integrations/slack/callback`,
            state,
        });

        return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
    }

    async handleCallback(query: any) {
        const { code, state } = query;
        if (!code || !state) throw new BadRequestException('Invalid callback');

        const payload = verifyState(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY!, state);
        if (!payload) throw new BadRequestException('Invalid or expired state');

        const { orgId, integrationId } = JSON.parse(payload);

        const res = await axios.post('https://slack.com/api/oauth.v2.access', null, {
            params: {
                client_id: process.env.SLACK_CLIENT_ID!,
                client_secret: process.env.SLACK_CLIENT_SECRET!,
                code,
                redirect_uri: `${process.env.API_URL}/api/v1/integrations/slack/callback`,
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
                    token: encrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY!, botToken)
                }
            }
        });

        return true;
    }

    async fetchSlackChannels(botTokenEncrypted: string) {
        const token = decrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY!, botTokenEncrypted);
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

    async ingestSlackHistory(botToken: string, channelId: string) {
        let cursor: string | undefined;

        do {
            const res = await axios.get('https://slack.com/api/conversations.history', {
                headers: { Authorization: `Bearer ${botToken}` },
                params: { channel: channelId, limit: 200, cursor }
            });

            if (!res.data.ok) throw new Error(res.data.error);

            for (const msg of res.data.messages) {
                if (msg.subtype) continue;
            }

            cursor = res.data.response_metadata?.next_cursor || undefined;
        } while (cursor);
    }
}