import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import { DatabaseService } from 'src/services/database/database.service';
import { encrypt } from 'src/utils/encryption';

@Injectable()
export class GithubIntegrationService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly jwtService: JwtService
    ) { }


    getInstallUrl(orgId: string) {
        // GitHub App installations are done on the app's page; use the "new installation" route
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
        return res.data.token as string; // token expires (about 1 hour)
    }


    async handleInstallation(installationId: string, orgId: string, setupAction?: string) {
        // store integration record and fetch initial repo list
        const installationToken = await this.generateInstallationToken(installationId);


        // create or update integration row
        const encryptedKey = encrypt(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || '', installationToken);

        console.log(encryptedKey);


        // const integration = await this.databaseService.integration.upsert({
        //     where: { organizationId_type: { organizationId: orgId, type: 'GITHUB' } },
        //     update: {
        //         status: 'CONNECTED',
        //         config: { installationId, encryptedToken: encryptedKey },
        //     },
        //     create: {
        //         organizationId: orgId,
        //         type: 'GITHUB',
        //         authType: 'APP_JWT',
        //         status: 'CONNECTED',
        //         config: { installationId, encryptedToken: encryptedKey },
        //     },
        // });

        const integration = await this.databaseService.integration.create({
            data: {
                organizationId: orgId,
                type: 'GITHUB',
                authType: 'APP_JWT',
                status: 'CONNECTED',
                config: { installationId, encryptedToken: encryptedKey },
            },
        });


        // fetch repositories for this installation and persist as IntegrationResource
        await this.fetchAndStoreInstallationRepos(integration.id, installationId, installationToken);


        return integration;
    }


    async fetchAndStoreInstallationRepos(integrationId: string, installationId: string, installationToken?: string) {
        const token = installationToken ?? (await this.generateInstallationToken(installationId));
        // pagination simplified; for production handle paging
        const res = await axios.get('https://api.github.com/installation/repositories', { headers: { Authorization: `token ${token}` } });
        const repos = res.data.repositories || [];


        for (const r of repos) {
            console.log(r)
            // await this.databaseService.integrationResource.upsert({
            //     where: { provider_providerId: { provider: 'GITHUB', providerId: String(r.id) } },
            //     update: {
            //         name: r.full_name,
            //         url: r.html_url,
            //     },
            //     create: {
            //         integrationId,
            //         provider: 'GITHUB',
            //         providerId: String(r.id),
            //         name: r.full_name,
            //         url: r.html_url,
            //     },
            // });
        }


        return repos;
    }
}