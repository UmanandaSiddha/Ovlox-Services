import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { ExternalProvider, IntegrationAuthType, IntegrationStatus } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { encrypt } from 'src/utils/encryption';

@Injectable()
export class NotionIntegrationService {
    constructor(private readonly databaseService: DatabaseService) { }

    getAuthUrl(orgId: string) {
        const params = new URLSearchParams({
            client_id: process.env.NOTION_CLIENT_ID,
            redirect_uri: `${process.env.API_URL}/api/v1/integrations/notion/callback`,
            response_type: 'code',
            owner: 'user',
            state: orgId,
        });
        return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
    }

    async handleCallback(query: any) {
        const { code, state } = query;
        if (!code) throw new HttpException('Missing code', HttpStatus.BAD_REQUEST);

        const tokenRes = await axios.post('https://api.notion.com/v1/oauth/token', {
            grant_type: 'authorization_code',
            code,
            redirect_uri: `${process.env.API_URL}/api/v1/integrations/notion/callback`,
        }, {
            auth: { username: process.env.NOTION_CLIENT_ID, password: process.env.NOTION_CLIENT_SECRET }
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
                        token: encrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY, access_token)
                    }
                }
            })
        } else {
            await this.databaseService.integration.create({
                data: {
                    organizationId: state,
                    type: ExternalProvider.NOTION,
                    authType: IntegrationAuthType.OAUTH,
                    status: IntegrationStatus.CONNECTED,
                    config: {
                        token: encrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY, access_token)
                    }
                }
            })
        }

        return true;
    }
}