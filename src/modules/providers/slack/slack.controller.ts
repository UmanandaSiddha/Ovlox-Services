import { Controller, Get, Headers, HttpCode, Post, Query, Req, Res, UseGuards, Param, BadRequestException } from "@nestjs/common";
import * as crypto from 'crypto';
import { Request, Response } from "express";
import { DatabaseService } from "src/services/database/database.service";
import { SlackService } from "./slack.service";
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';
import { ConfigService } from '@nestjs/config';

@Controller('integrations/slack')
export class SlackController {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly slackService: SlackService,
        private readonly configService: ConfigService,
    ) { }

    @Get('install/:orgId/:integrationId')
    install(@Param('orgId') orgId: string, @Param('integrationId') integrationId: string, @Res() res: Response) {
        return res.redirect(this.slackService.getAuthUrl(orgId, integrationId));
    }

    @Get('callback')
    async callback(@Query() query, @Res() res: Response) {
        const FRONTEND_URL = this.configService.get<string>('FRONTEND_URL');
        await this.slackService.handleCallback(query);
        return res.redirect(`${FRONTEND_URL}/integrations?status=connected`);
    }

    @Post('webhook')
    @HttpCode(200)
    async webhook(@Req() req: Request, @Res() res: Response, @Headers('x-slack-signature') signature: string, @Headers('x-slack-request-timestamp') ts: string) {
        const SLACK_SIGNING_SECRET = this.configService.get<string>('SLACK_SIGNING_SECRET');
        const rawBody = (req as any).rawBody ?? JSON.stringify(req.body);
        const base = `v0:${ts}:${rawBody}`;
        const expected = 'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET!).update(base).digest('hex');

        try {
            if (!crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected))) {
                return res.status(401).send('invalid signature');
            }
        } catch {
            return res.status(401).send('invalid signature');
        }

        if (req.body?.type === 'url_verification') {
            return res.json({ challenge: req.body.challenge });
        }

        await this.slackService.handleWebhook(req.body);

        return res.send('ok');
    }

    @UseGuards(AuthGuard)
    @Get('channels/:integrationId')
    async getChannels(@Param('integrationId') integrationId: string) {
        return this.slackService.fetchSlackChannels(integrationId);
    }

    @UseGuards(AuthGuard)
    @Post('sync-channels/:integrationId')
    async syncChannels(@Param('integrationId') integrationId: string) {
        return this.slackService.syncChannels(integrationId);
    }

    @UseGuards(AuthGuard)
    @Post('ingest/:integrationId')
    async ingest(@Param('integrationId') integrationId: string, @Query('channelId') channelId: string, @Query('projectId') projectId?: string) {
        if (!channelId) {
            throw new BadRequestException('channelId is required');
        }
        return this.slackService.ingestSlackHistory(integrationId, channelId, projectId);
    }
}