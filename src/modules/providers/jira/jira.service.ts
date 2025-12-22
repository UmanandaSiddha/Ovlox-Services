import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { ExternalProvider, IntegrationAuthType, IntegrationStatus } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { encrypt } from 'src/utils/encryption';


@Injectable()
export class JiraIntegrationService {
    constructor(private readonly databaseService: DatabaseService) { }

    getAuthUrl(orgId: string) {
        const params = new URLSearchParams({
            audience: 'api.atlassian.com',
            client_id: process.env.JIRA_CLIENT_ID,
            scope: 'read:jira-work write:jira-work',
            redirect_uri: `${process.env.API_URL}/api/v1/integrations/jira/callback`,
            state: orgId,
            response_type: 'code',
        });

        return `https://auth.atlassian.com/authorize?${params.toString()}`;
    }

    async handleCallback(query: any) {
        const { code, state } = query;
        if (!code) throw new HttpException('Missing code', HttpStatus.BAD_REQUEST);

        const tokenRes = await axios.post('https://auth.atlassian.com/oauth/token', {
            grant_type: 'authorization_code',
            client_id: process.env.JIRA_CLIENT_ID,
            client_secret: process.env.JIRA_CLIENT_SECRET,
            code,
            redirect_uri: `${process.env.API_URL}/api/v1/integrations/jira/callback`,
        });

        const { access_token, refresh_token, expires_in } = tokenRes.data;

        const integration = await this.databaseService.integration.findFirst({
            where: { organizationId: state, type: ExternalProvider.JIRA }
        });

        if (integration) {
            await this.databaseService.integration.update({
                where: { id: integration.id },
                data: {
                    status: IntegrationStatus.CONNECTED,
                    config: {
                        token: encrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY, access_token),
                        refreshToken: encrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY, refresh_token),
                        expiresAt: new Date(Date.now() + expires_in * 1000).toISOString()
                    }
                }
            })
        } else {
            await this.databaseService.integration.create({
                data: {
                    organizationId: state,
                    type: ExternalProvider.JIRA,
                    authType: IntegrationAuthType.OAUTH,
                    status: IntegrationStatus.CONNECTED,
                    config: {
                        token: encrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY, access_token),
                        refreshToken: encrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY, refresh_token),
                        expiresAt: new Date(Date.now() + expires_in * 1000).toISOString()
                    }
                }
            })
        }

        return true;
    }
}