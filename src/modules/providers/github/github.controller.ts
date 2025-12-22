import { Controller, Get, Query, Res, HttpException, HttpStatus, Post, HttpCode, Req, Headers, Body } from '@nestjs/common';
import { Request, Response } from 'express';
import { GithubIntegrationService } from './github.service';
import { DatabaseService } from 'src/services/database/database.service';
import * as crypto from 'crypto';

@Controller('integrations/github')
export class GithubIntegrationController {
    constructor(
        private readonly github: GithubIntegrationService,
        private readonly databaseService: DatabaseService
    ) { }

    @Get('install')
    install(@Query('orgId') orgId: string, @Res() res: Response) {
        if (!orgId) throw new HttpException('orgId required', HttpStatus.BAD_REQUEST);
        const url = this.github.getInstallUrl(orgId);
        return res.redirect(url);
    }

    @Get('callback')
    async callback(@Query('installation_id') installationId: string, @Query('setup_action') setupAction: string, @Query('state') state: string, @Res() res: Response) {
        if (!installationId) throw new HttpException('installation_id required', HttpStatus.BAD_REQUEST);

        try {
            const orgId = state;
            await this.github.handleInstallation(installationId, orgId, setupAction);

            const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
            return res.redirect(`${frontend}/organizations/${orgId}/setup?connected=github`);
        } catch (err) {
            console.error(err);
            throw new HttpException('GitHub callback handling failed', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post('webhook')
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

        const providerEventId = body.installation ? String(body.installation.id) : undefined;
        await this.databaseService.webhookEvent.create({ data: { provider: 'GITHUB', providerEventId, payload: body } });

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
