import { Controller, Post, Body, UseGuards, Req, Param, Get } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { AuthGuard } from '../auth/guards/auth.guard';

@UseGuards(AuthGuard)
@Controller('projects')
export class ProjectsController {
    constructor(private projects: ProjectsService) { }

    @Post('create')
    async create(@Req() req: any, @Body() body: { organizationId: string; name: string; description?: string }) {
        return this.projects.create({ ...body, createdBy: req.user.userId });
    }

    @Post(':id/link-integration')
    async link(@Param('id') id: string, @Body() body: { integrationId: string; items: any }) {
        return this.projects.linkIntegration(id, body.integrationId, body.items);
    }

    @Get(':id')
    async get(@Param('id') id: string) {
        return this.projects.list(id);
    }
}