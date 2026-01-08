import { Controller, Get, Headers, HttpCode, Post, Query, Req, Res } from "@nestjs/common";
import * as crypto from 'crypto';
import { Request, Response } from "express";
import { DatabaseService } from "src/services/database/database.service";
import { SlackService } from "./slack.service";
import { ExternalProvider } from "generated/prisma/enums";

@Controller('integrations/slack')
export class SlackController {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly slackService: SlackService
    ) { }

    @Get('install')
    install(@Query('orgId') orgId: string, @Query('integrationId') integrationId: string, @Res() res: Response) {
        return res.redirect(this.slackService.getAuthUrl(orgId, integrationId));
    }

    @Get('callback')
    async callback(@Query() query, @Res() res: Response) {
        await this.slackService.handleCallback(query);
        return res.redirect(`${process.env.FRONTEND_URL}/integrations/slack/success`);
    }

    @Post('webhook')
    @HttpCode(200)
    async webhook(@Req() req: Request, @Res() res: Response, @Headers('x-slack-signature') signature: string, @Headers('x-slack-request-timestamp') ts: string) {
        const rawBody = (req as any).rawBody ?? JSON.stringify(req.body);
        const base = `v0:${ts}:${rawBody}`;
        const signingSecret = process.env.SLACK_SIGNING_SECRET!;
        const expected = 'v0=' + crypto.createHmac('sha256', signingSecret).update(base).digest('hex');

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

        const event = req.body.event;
        if (!event || event.subtype || event.type !== 'message') return res.send('ok');

        await this.databaseService.webhookEvent.create({
            data: {
                provider: ExternalProvider.SLACK,
                providerEventId: event.event_ts,
                payload: req.body,
            }
        });

        return res.send('ok');
    }
}