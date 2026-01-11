import { Controller, Get, Post, Query, Param, UseGuards, HttpCode, Res, Body, Req } from '@nestjs/common';
import { Response, Request } from 'express';
import { JiraIntegrationService } from './jira.service';
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';

@Controller('integrations/jira')
export class JiraController {
    constructor(
        private readonly jiraService: JiraIntegrationService,
        private readonly configService: ConfigService,
    ) { }

    @UseGuards(AuthGuard)
    @Get('install/:orgId')
    getInstallUrl(@Param('orgId') orgId: string) {
        return { url: this.jiraService.getAuthUrl(orgId) };
    }

    @Get('callback')
    @HttpCode(200)
    async callback(@Query() query: any, @Res() res: Response) {
        const FRONTEND_URL = this.configService.get<string>('FRONTEND_URL');
        await this.jiraService.handleCallback(query);
        return res.redirect(`${FRONTEND_URL}/integrations?status=connected`);
    }

    @Post('webhook')
    @HttpCode(200)
    async webhook(@Req() req: Request, @Res() res: Response) {
        await this.jiraService.handleWebhook(req.body);
        return res.send('ok');
    }

    @UseGuards(AuthGuard)
    @Get('projects/:integrationId')
    async getProjects(@Param('integrationId') integrationId: string) {
        return this.jiraService.fetchProjects(integrationId);
    }

    @UseGuards(AuthGuard)
    @Post('sync-projects/:integrationId')
    async syncProjects(@Param('integrationId') integrationId: string) {
        return this.jiraService.syncProjects(integrationId);
    }

    @UseGuards(AuthGuard)
    @Post('ingest/:integrationId')
    async ingest(@Param('integrationId') integrationId: string, @Query('projectKey') projectKey?: string, @Query('jql') jql?: string) {
        return this.jiraService.ingestIssues(integrationId, projectKey, jql);
    }
}
