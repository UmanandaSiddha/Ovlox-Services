import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { ExternalProvider, IntegrationAuthType, IntegrationStatus } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { encrypt } from 'src/utils/encryption';


@Injectable()
export class DiscordIntegrationService {
    constructor(private readonly databaseService: DatabaseService) { }


    getAuthUrl(orgId: string) {
        const params = new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            redirect_uri: `${process.env.API_URL}/api/v1/integrations/discord/callback`,
            response_type: 'code',
            scope: 'bot%20identify%20guilds',
            state: orgId,
            permissions: process.env.DISCORD_BOT_PERMISSIONS || '0',
        });
        return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
    }


    async handleCallback(query: any) {
        const { code, state } = query;
        if (!code) throw new HttpException('Missing code', HttpStatus.BAD_REQUEST);


        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: `${process.env.API_URL}/api/v1/integrations/discord/callback`,
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });


        const data = tokenRes.data;
        const botToken = data.access_token;

        const integration = await this.databaseService.integration.findFirst({
            where: { organizationId: state, type: ExternalProvider.DISCORD }
        });

        if (integration) {
            await this.databaseService.integration.update({
                where: { id: integration.id },
                data: {
                    status: IntegrationStatus.CONNECTED,
                    config: {
                        token: encrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY, botToken)
                    }
                }
            })
        } else {
            await this.databaseService.integration.create({
                data: {
                    organizationId: state,
                    type: ExternalProvider.DISCORD,
                    authType: IntegrationAuthType.OAUTH,
                    status: IntegrationStatus.CONNECTED,
                    config: {
                        token: encrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY, botToken)
                    }
                }
            })
        }

        return true;
    }
}