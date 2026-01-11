import { Controller, Post, Req, Res, HttpCode, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { DatabaseService } from 'src/services/database/database.service';
import { DiscordService } from './discord.service';
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';
import { verifyState } from 'src/utils/oauth-state';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';

@Controller('integrations/discord')
export class DiscordController {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly discordService: DiscordService,
        private readonly configService: ConfigService,
    ) { }

    @Get('callback')
    @HttpCode(200)
    async callback(@Query() query: any) {
        const INTEGRATION_TOKEN_ENCRYPTION_KEY = this.configService.get<string>('INTEGRATION_TOKEN_ENCRYPTION_KEY');
        const FRONTEND_URL = this.configService.get<string>('FRONTEND_URL');

        if (!INTEGRATION_TOKEN_ENCRYPTION_KEY || !FRONTEND_URL) {
            throw new BadRequestException('Configuration error');
        }

        await this.discordService.handleCallback(query);
        return `<script>window.location.href = '${FRONTEND_URL}/integrations?status=connected'</script>`;
    }

    @UseGuards(AuthGuard)
    @Get('install/:orgId/:integrationId')
    getInstallUrl(@Param('orgId') orgId: string, @Param('integrationId') integrationId: string) {
        return { url: this.discordService.getInstallUrl(orgId, integrationId) };
    }

    @Post('webhook')
    @HttpCode(200)
    async webhook(@Req() req: Request, @Res() res: Response) {
        await this.discordService.handleWebhook(req.body);
        return res.send('ok');
    }

    @UseGuards(AuthGuard)
    @Get('channels/:integrationId')
    async getChannels(@Param('integrationId') integrationId: string, @Query('guildId') guildId: string) {
        if (!guildId) {
            throw new BadRequestException('guildId is required');
        }
        return this.discordService.fetchGuildChannels(guildId);
    }

    @UseGuards(AuthGuard)
    @Post('sync-channels/:integrationId')
    async syncChannels(@Param('integrationId') integrationId: string, @Query('guildId') guildId: string) {
        if (!guildId) {
            throw new BadRequestException('guildId is required');
        }
        return this.discordService.syncChannels(integrationId, guildId);
    }

    @UseGuards(AuthGuard)
    @Post('ingest/:integrationId')
    async ingest(@Param('integrationId') integrationId: string, @Query('channelId') channelId: string, @Query('projectId') projectId?: string) {
        if (!channelId) {
            throw new BadRequestException('channelId is required');
        }
        return this.discordService.ingestChannelHistory(integrationId, channelId, projectId);
    }
}