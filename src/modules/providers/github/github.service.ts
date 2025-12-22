import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import { ExternalProvider, IntegrationStatus } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { decrypt, encrypt } from 'src/utils/encryption';

@Injectable()
export class GithubIntegrationService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly jwtService: JwtService
    ) { }

    getInstallUrl(orgId: string) {
        const slug = process.env.GITHUB_APP_SLUG;
        const state = encodeURIComponent(orgId);
        return `https://github.com/apps/${slug}/installations/new?state=${state}`;
    }

    createAppJwt() {
        const privateKey = (process.env.GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n');
        const now = Math.floor(Date.now() / 1000);
        const payload = { iat: now - 60, exp: now + (10 * 60), iss: process.env.GITHUB_APP_ID };
        return this.jwtService.sign(payload, { secret: privateKey, algorithm: 'RS256' });
    }

    async generateInstallationToken(installationId: string) {
        const appJwt = this.createAppJwt();
        const res = await axios.post(
            `https://api.github.com/app/installations/${installationId}/access_tokens`,
            {},
            { headers: { Authorization: `Bearer ${appJwt}`, Accept: 'application/vnd.github+json' } },
        );
        return res.data.token as string;
    }

    async handleInstallation(installationId: string, orgId: string, setupAction?: string) {
        const installationToken = await this.generateInstallationToken(installationId);

        const integration = await this.databaseService.integration.findFirst({
            where: { organizationId: orgId, type: ExternalProvider.GITHUB }
        });

        if (!integration) {
            throw new HttpException('Integration Not Found', HttpStatus.BAD_REQUEST);
        }

        const encryptedKey = encrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || '', installationToken);

        await this.databaseService.integration.update({
            where: { id: integration.id },
            data: {
                status: IntegrationStatus.CONNECTED,
                config: { installationId, encryptedToken: encryptedKey },
            }
        });

        return integration;
    }

    async fetchAndStoreInstallationRepos(integrationId: string, installationId: string, installationToken?: string) {
        const token = installationToken ?? (await this.generateInstallationToken(installationId));

        const res = await axios.get('https://api.github.com/installation/repositories', { headers: { Authorization: `token ${token}` } });
        const repos = res.data.repositories || [];

        for (const r of repos) {
            let resource = await this.databaseService.integrationResource.findFirst({
                where: { provider: 'GITHUB', providerId: String(r.id) }
            });

            if (resource) {
                await this.databaseService.integrationResource.update({
                    where: { id: resource.id },
                    data: {
                        name: r.full_name,
                        url: r.html_url,
                    }
                })
            } else {
                resource = await this.databaseService.integrationResource.create({
                    data: {
                        integrationId,
                        provider: ExternalProvider.GITHUB,
                        providerId: String(r.id),
                        name: r.full_name,
                        url: r.html_url,
                    }
                })
            }
        }

        return repos;
    }

    async getValidInstallationToken(installationId: string, integrationId: string) {
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId },
        });

        const config = integration.config as any;

        if (config?.token && config?.expiresAt) {
            const expires = new Date(config.expiresAt).getTime();
            if (Date.now() < expires - 60000) {
                return decrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY, config.token);
            }
        }

        const appJwt = this.createAppJwt();

        const res = await axios.post(
            `https://api.github.com/app/installations/${installationId}/access_tokens`,
            {},
            {
                headers: {
                    Authorization: `Bearer ${appJwt}`,
                    Accept: "application/vnd.github+json",
                },
            },
        );

        const rawToken = res.data.token;
        const expiresAt = res.data.expires_at;

        // Save encrypted token back
        await this.databaseService.integration.update({
            where: { id: integrationId },
            data: {
                config: {
                    ...config,
                    token: encrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY, rawToken),
                    expiresAt,
                },
            },
        });

        return rawToken;
    }
}