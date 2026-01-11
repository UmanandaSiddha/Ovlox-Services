import { Controller, Get, Post, Query, Param, UseGuards, HttpCode, Res, Body, Req } from '@nestjs/common';
import { Response, Request } from 'express';
import { FigmaService } from './figma.service';
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';

@Controller('integrations/figma')
export class FigmaController {
    constructor(
        private readonly figmaService: FigmaService,
        private readonly configService: ConfigService,
    ) { }

    @UseGuards(AuthGuard)
    @Get('install/:orgId')
    getInstallUrl(@Param('orgId') orgId: string) {
        return { url: this.figmaService.getAuthUrl(orgId) };
    }

    @Get('callback')
    @HttpCode(200)
    async callback(@Query() query: any, @Res() res: Response) {
        const FRONTEND_URL = this.configService.get<string>('FRONTEND_URL');
        await this.figmaService.handleCallback(query);
        return res.redirect(`${FRONTEND_URL}/integrations?status=connected`);
    }

    @Post('webhook')
    @HttpCode(200)
    async webhook(@Req() req: Request, @Res() res: Response) {
        await this.figmaService.handleWebhook(req.body);
        return res.send('ok');
    }

    @UseGuards(AuthGuard)
    @Get('files/:integrationId')
    async getFiles(@Param('integrationId') integrationId: string, @Query('teamId') teamId?: string) {
        return this.figmaService.fetchFiles(integrationId, teamId);
    }

    @UseGuards(AuthGuard)
    @Post('sync-resources/:integrationId')
    async syncResources(@Param('integrationId') integrationId: string, @Query('teamId') teamId?: string) {
        return this.figmaService.syncResources(integrationId, teamId);
    }

    @UseGuards(AuthGuard)
    @Post('ingest/:integrationId')
    async ingest(@Param('integrationId') integrationId: string, @Query('fileKey') fileKey?: string, @Query('type') type?: 'files' | 'comments' | 'versions') {
        if (!fileKey && type !== 'files') {
            throw new BadRequestException('fileKey is required for comments and versions');
        }

        if (type === 'comments') {
            return this.figmaService.ingestComments(integrationId, fileKey!);
        } else if (type === 'versions') {
            return this.figmaService.ingestVersions(integrationId, fileKey!);
        } else {
            return this.figmaService.ingestFiles(integrationId, fileKey);
        }
    }
}
