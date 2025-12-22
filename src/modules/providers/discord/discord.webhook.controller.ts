import { Controller, Post, Req, Res, HttpCode, Headers } from '@nestjs/common';
import { Request, Response } from 'express';
import { DatabaseService } from '../../services/database/database.service';


@Controller('api/v1/webhooks/discord')
export class DiscordWebhookController {
    constructor(private readonly db: DatabaseService) { }


    @Post()
    @HttpCode(200)
    async handle(@Req() req: Request, @Res() res: Response) {
        // Discord mostly uses gateway/websocket for events; webhooks are simpler (incoming webhooks)
        await this.db.webhookEvent.create({ data: { provider: 'DISCORD', providerEventId: undefined, payload: req.body } });
        return res.send('ok');
    }
}