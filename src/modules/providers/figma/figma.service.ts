import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { ExternalProvider, IntegrationAuthType, IntegrationStatus } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { encrypt } from 'src/utils/encryption';

@Injectable()
export class FigmaIntegrationService {
    constructor(private readonly databaseService: DatabaseService) { }

    getAuthUrl(orgId: string) {
        const params = new URLSearchParams({
            client_id: process.env.FIGMA_CLIENT_ID,
            redirect_uri: `${process.env.API_URL}/api/v1/integrations/figma/callback`,
            state: orgId,
            scope: 'file_read',
        });
        return `https://www.figma.com/oauth?${params.toString()}`;
    }

    async handleCallback(query: any) {
        const { code, state } = query;
        if (!code) throw new HttpException('Missing code', HttpStatus.BAD_REQUEST);

        const tokenRes = await axios.post('https://www.figma.com/api/oauth/token', new URLSearchParams({
            client_id: process.env.FIGMA_CLIENT_ID,
            client_secret: process.env.FIGMA_CLIENT_SECRET,
            redirect_uri: `${process.env.API_URL}/api/v1/integrations/figma/callback`,
            code,
            grant_type: 'authorization_code',
        }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const { access_token, refresh_token, expires_in } = tokenRes.data;

        const integration = await this.databaseService.integration.findFirst({
            where: { organizationId: state, type: ExternalProvider.FIGMA }
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
                    type: ExternalProvider.FIGMA,
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