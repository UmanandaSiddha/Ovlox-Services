import { Controller, Post, Req, Res, Headers, Body, HttpCode } from '@nestjs/common';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { DatabaseService } from 'src/services/database/database.service';

@Controller('api/v1/webhooks/github')
export class GithubWebhookController {
    constructor(private readonly databaseService: DatabaseService) { }

    @Post()
    @HttpCode(200)
    async handle(@Req() req: Request, @Res() res: Response, @Headers('x-hub-signature-256') signature: string, @Body() body: any) {
        const secret = process.env.GITHUB_WEBHOOK_SECRET || '';
        const raw = JSON.stringify(body);
        const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');


        try {
            const sigBuf = Buffer.from(signature || '');
            const expBuf = Buffer.from(expected);
            if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
                console.warn('Invalid GitHub webhook signature');
                return res.status(401).send('Invalid signature');
            }
        } catch (err) {
            return res.status(401).send('Invalid signature');
        }


        // store webhook event
        const providerEventId = body.installation ? String(body.installation.id) : undefined;
        await this.databaseService.webhookEvent.create({ data: { provider: 'GITHUB', providerEventId, payload: body } });


        // basic normalization example for push / pull_request / issues
        const event = req.headers['x-github-event'] as string;
        if (event === 'push') {
            const head = body.head_commit;
            await this.databaseService.rawEvent.create({
                data: {
                    projectId: null,
                    integrationId: null,
                    source: 'GITHUB',
                    sourceId: body.after,
                    eventType: 'COMMIT',
                    authorName: head?.author?.name || null,
                    authorEmail: head?.author?.email || null,
                    timestamp: new Date(head?.timestamp || Date.now()),
                    content: head?.message || null,
                    metadata: body,
                },
            });
        }


        return res.send('ok');
    }
}