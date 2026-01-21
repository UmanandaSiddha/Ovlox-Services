import { Controller, Get, Query, Res, HttpException, HttpStatus, Post, HttpCode, Headers, Body, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { verifyState } from 'src/utils/oauth-state';
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';
import { ConfigService } from '@nestjs/config';
import { GithubService } from './github.service';

@Controller('integrations/github')
export class GithubController {
    constructor(
        private readonly githubService: GithubService,
        private readonly configService: ConfigService
    ) { }


    @UseGuards(AuthGuard)
    @Get('oauth/:id')
    getOauthUrl(@Param('id') orgId: string, @Query('force') force?: string) {
        return this.githubService.getOAuthUrl(orgId, force === 'true');
    }

    @UseGuards(AuthGuard)
    @Get('install/:id')
    getInstallUrl(@Param('id') orgId: string) {
        return this.githubService.getInstallUrl(orgId);
    }

    @Get('callback')
    @HttpCode(200)
    async callback(
        @Query('code') code: string,
        @Query('state') state?: string,
        @Query('installation_id') installation_id?: string,
        @Query('setup_action') setup_action?: string
    ) {
        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');
        const FRONTEND_URL = this.configService.get<string>('FRONTEND_URL');

        if (!INTEGRATION_TOKEN_ENCRYPTION_KEY || !FRONTEND_URL) {
            throw new BadRequestException("Something went wrong");
        }

        // Handle GitHub App installation callback
        if (installation_id) {
            const payload = verifyState(INTEGRATION_TOKEN_ENCRYPTION_KEY, state || '');
            if (!payload) {
                throw new HttpException('Invalid state', HttpStatus.BAD_REQUEST);
            }

            const { orgId, integrationId } = JSON.parse(payload);

            // Update integration immediately so the system works even if webhook doesn't fire
            await this.githubService.handleInstallationCallback(orgId, integrationId, installation_id);

            // Redirect to frontend
            return `<script>window.location.href = '${FRONTEND_URL}/integrations?status=installed&installation_id=${installation_id}'</script>`;
        }

        // Handle OAuth callback (legacy OAuth flow)
        const payload = verifyState(INTEGRATION_TOKEN_ENCRYPTION_KEY, state || '');
        if (!payload) throw new HttpException('Invalid state', HttpStatus.BAD_REQUEST);

        const { orgId, replace } = JSON.parse(payload);

        await this.githubService.handleOAuthCallback(code, orgId, !!replace);

        return `<script>window.location.href = '${FRONTEND_URL}/integrations?status=connected'</script>`;
    }

    @Post('webhook')
    @HttpCode(200)
    async webhook(
        @Headers('x-hub-signature-256') signature: string,
        @Headers('x-github-event') event: string,
        @Body() body: any
    ) {
        this.githubService.verifySignature(body, signature);
        await this.githubService.handleWebhook(event, body);

        return 'ok';
    }

    @UseGuards(AuthGuard)
    @Get('repo/:id')
    getInstallationRepos(@Param('id') integrationId: string) {
        return this.githubService.fetchInstallationRepos(integrationId);
    }

    @UseGuards(AuthGuard)
    @Post('sync-repos/:id')
    async syncRepos(@Param('id') integrationId: string) {
        return this.githubService.syncRepositories(integrationId);
    }

    @UseGuards(AuthGuard)
    @Get('overview/:id')
    getRepoOverview(@Param('id') integrationId: string) {
        return this.githubService.getGithubOverview(integrationId);
    }

    @UseGuards(AuthGuard)
    @Get('commits/:id')
    getCommits(@Param('id') integrationId: string) {
        return this.githubService.getGithubCommits(integrationId, 10);
    }

    @UseGuards(AuthGuard)
    @Get('commit/details/:id/:sha')
    getCommitDetails(@Param('id') integrationId: string, @Param('sha') sha: string) {
        return this.githubService.getGithubCommitDetail(integrationId, sha);
    }

    @UseGuards(AuthGuard)
    @Get('pull-requests/:id')
    getPullRequests(@Param('id') integrationId: string) {
        return this.githubService.getGithubPullRequests(integrationId, 10);
    }

    @UseGuards(AuthGuard)
    @Get('issues/:id')
    getIssues(@Param('id') integrationId: string) {
        return this.githubService.getGithubIssues(integrationId, 10);
    }

    @UseGuards(AuthGuard)
    @Get('debug/:id/:sha')
    debugCommit(@Param('id') integrationId: string, @Param('sha') sha: string) {
        return this.githubService.debugGithubCommit(integrationId, sha);
    }
}
