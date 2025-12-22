import { Controller, Get, Param, Query, Res, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { GithubIntegrationService } from './github/github.service';
import { SlackIntegrationService } from '../providers/slack/slack.integration.service';
import { DiscordIntegrationService } from '../providers/discord/discord.integration.service';
import { NotionIntegrationService } from '../providers/notion/notion.integration.service';
import { JiraIntegrationService } from '../providers/jira/jira.integration.service';
import { FigmaIntegrationService } from '../providers/figma/figma.integration.service';


@Controller('api/v1/integrations')
export class IntegrationsController {
    constructor(
        private readonly github: GithubIntegrationService,
        private readonly slack: SlackIntegrationService,
        private readonly discord: DiscordIntegrationService,
        private readonly notion: NotionIntegrationService,
        private readonly jira: JiraIntegrationService,
        private readonly figma: FigmaIntegrationService,
    ) { }


    @Get(':provider/install')
    async install(@Param('provider') provider: string, @Query('orgId') orgId: string, @Res() res: Response) {
        if (!orgId) throw new HttpException('orgId required', HttpStatus.BAD_REQUEST);
        switch (provider) {
            case 'github': return res.redirect(this.github.getInstallUrl(orgId));
            case 'slack': return res.redirect(this.slack.getAuthUrl(orgId));
            case 'discord': return res.redirect(this.discord.getAuthUrl(orgId));
            case 'notion': return res.redirect(this.notion.getAuthUrl(orgId));
            case 'jira': return res.redirect(this.jira.getAuthUrl(orgId));
            case 'figma': return res.redirect(this.figma.getAuthUrl(orgId));
            default: throw new HttpException('Unsupported provider', HttpStatus.BAD_REQUEST);
        }
    }


    @Get(':provider/callback')
    async callback(@Param('provider') provider: string, @Query() query: any, @Res() res: Response) {
        try {
            switch (provider) {
                case 'github': await this.github.handleCallback(query); break;
                case 'slack': await this.slack.handleCallback(query); break;
                case 'discord': await this.discord.handleCallback(query); break;
                case 'notion': await this.notion.handleCallback(query); break;
                case 'jira': await this.jira.handleCallback(query); break;
                case 'figma': await this.figma.handleCallback(query); break;
                default: throw new HttpException('Unsupported provider', HttpStatus.BAD_REQUEST);
            }


            // State should contain orgId; redirect to frontend setup
            const orgId = query.state || query.orgId || query.team_id || query.installation_id;
            const front = process.env.FRONTEND_URL || 'http://localhost:3000';
            return res.redirect(`${front}/organizations/${orgId}/setup?connected=${provider}`);
        } catch (err) {
            console.error('integration callback error', err);
            throw new HttpException('integration callback failed', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}