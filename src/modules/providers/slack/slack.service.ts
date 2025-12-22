import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ExternalProvider } from '@prisma/client';
import axios from 'axios';
import { IntegrationAuthType, IntegrationStatus } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { encrypt } from 'src/utils/encryption';

@Injectable()
export class SlackIntegrationService {
    constructor(private readonly databaseService: DatabaseService) { }

    getAuthUrl(orgId: string) {
        const params = new URLSearchParams({
            client_id: process.env.SLACK_CLIENT_ID,
            scope: 'channels:read,groups:read,channels:history,chat:write,conversations:read,users:read',
            redirect_uri: `${process.env.API_URL}/api/v1/integrations/slack/callback`,
            state: orgId,
        });
        return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
    }

    async handleCallback(query: any) {
        const { code, state } = query;
        if (!code) throw new HttpException('Missing code', HttpStatus.BAD_REQUEST);

        const res = await axios.post('https://slack.com/api/oauth.v2.access', null, {
            params: {
                client_id: process.env.SLACK_CLIENT_ID,
                client_secret: process.env.SLACK_CLIENT_SECRET,
                code,
                redirect_uri: `${process.env.API_URL}/api/v1/integrations/slack/callback`,
            },
        });

        if (!res.data.ok) throw new HttpException('Slack OAuth failed', HttpStatus.INTERNAL_SERVER_ERROR);

        const botToken = res.data.access_token;
        const team = res.data.team;

        const integration = await this.databaseService.integration.findFirst({
            where: { organizationId: state, type: ExternalProvider.SLACK }
        });

        if (integration) {
            await this.databaseService.integration.update({
                where: { id: integration.id },
                data: {
                    status: IntegrationStatus.CONNECTED,
                    config: {
                        teamId: team.id,
                        token: encrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY, botToken)
                    }
                }
            })
        } else {
            await this.databaseService.integration.create({
                data: {
                    organizationId: state,
                    type: ExternalProvider.SLACK,
                    authType: IntegrationAuthType.OAUTH,
                    status: IntegrationStatus.CONNECTED,
                    config: {
                        teamId: team.id,
                        token: encrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY, botToken)
                    },
                }
            })
        }

        return true;
    }
}