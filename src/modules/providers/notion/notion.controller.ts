import { Controller, Get, Post, Query, Param, UseGuards, HttpCode, Res, Body, Req } from '@nestjs/common';
import { Response, Request } from 'express';
import { NotionIntegrationService } from './notion.service';
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';

@Controller('integrations/notion')
export class NotionController {
    constructor(
        private readonly notionService: NotionIntegrationService,
        private readonly configService: ConfigService,
    ) { }

    @UseGuards(AuthGuard)
    @Get('install/:orgId')
    getInstallUrl(@Param('orgId') orgId: string) {
        return { url: this.notionService.getAuthUrl(orgId) };
    }

    @Get('callback')
    @HttpCode(200)
    async callback(@Query() query: any, @Res() res: Response) {
        const FRONTEND_URL = this.configService.get<string>('FRONTEND_URL');
        await this.notionService.handleCallback(query);
        return res.redirect(`${FRONTEND_URL}/integrations?status=connected`);
    }

    @Post('webhook')
    @HttpCode(200)
    async webhook(@Req() req: Request, @Res() res: Response) {
        await this.notionService.handleWebhook(req.body);
        return res.send('ok');
    }

    @UseGuards(AuthGuard)
    @Get('databases/:integrationId')
    async getDatabases(@Param('integrationId') integrationId: string) {
        return this.notionService.fetchDatabases(integrationId);
    }

    @UseGuards(AuthGuard)
    @Post('sync-resources/:integrationId')
    async syncResources(@Param('integrationId') integrationId: string) {
        return this.notionService.syncResources(integrationId);
    }

    @UseGuards(AuthGuard)
    @Post('ingest/:integrationId')
    async ingest(@Param('integrationId') integrationId: string, @Query('databaseId') databaseId?: string) {
        return this.notionService.ingestPages(integrationId, databaseId);
    }
}
