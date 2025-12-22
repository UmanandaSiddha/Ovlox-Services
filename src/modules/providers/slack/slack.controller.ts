import { Controller, Headers, HttpCode, Post, Req, Res } from "@nestjs/common";
import * as crypto from 'crypto';
import { Request, Response } from "express";
import { DatabaseService } from "src/services/database/database.service";

@Controller('integrations/slack')
export class GithubIntegrationController {
    constructor(
        private readonly databaseService: DatabaseService
    ) { }

    @Post('webhook')
    @HttpCode(200)
    async handle(@Req() req: Request, @Res() res: Response, @Headers('x-slack-signature') signature: string, @Headers('x-slack-request-timestamp') ts: string) {
        const body = (req as any).rawBody ?? JSON.stringify(req.body);
        const signingSecret = process.env.SLACK_SIGNING_SECRET || '';
        const base = `v0:${ts}:${body}`;
        const hmac = 'v0=' + crypto.createHmac('sha256', signingSecret).update(base).digest('hex');

        try {
            const sigBuf = Buffer.from(signature || '');
            const expBuf = Buffer.from(hmac);
            if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
                return res.status(401).send('invalid signature');
            }
        } catch (err) {
            return res.status(401).send('invalid signature');
        }

        await this.databaseService.webhookEvent.create({ data: { provider: 'SLACK', providerEventId: req.body?.event?.event_ts ?? undefined, payload: req.body } });

        return res.send('ok');
    }
}