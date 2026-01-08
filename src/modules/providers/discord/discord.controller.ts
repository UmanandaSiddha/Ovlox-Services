import { Controller, Post, Req, Res, HttpCode, Headers } from '@nestjs/common';
import { Request, Response } from 'express';
import { DatabaseService } from 'src/services/database/database.service';


@Controller('integrations/discord')
export class DiscordController {
    constructor(private readonly databaseService: DatabaseService) { }

    @Post('webhook')
    @HttpCode(200)
    async handle(@Req() req: Request, @Res() res: Response) {
        await this.databaseService.webhookEvent.create({ data: { provider: 'DISCORD', providerEventId: undefined, payload: req.body } });
        return res.send('ok');
    }
}