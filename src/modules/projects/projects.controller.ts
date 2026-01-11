import { Controller, Post, Body, UseGuards, Req, Param, Get, Put, Delete, Query } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorator/permission.decorator';
import { PermissionName } from 'generated/prisma/enums';
import { QueryString } from 'src/utils/apiFeatures';

@Controller('orgs/:orgId/projects')
@UseGuards(AuthGuard, PermissionGuard)
export class ProjectsController {
    constructor(private projects: ProjectsService) { }

    @Post()
    @RequirePermission(PermissionName.CREATE_PROJECTS)
    async create(
        @Param('orgId') orgId: string,
        @getUser('id') userId: string,
        @Body() body: { name: string; description?: string }
    ) {
        return this.projects.create({ ...body, organizationId: orgId, createdBy: userId });
    }

    @Get()
    @RequirePermission(PermissionName.VIEW_PROJECTS)
    async list(@Param('orgId') orgId: string, @Query() filters: QueryString) {
        return this.projects.listByOrg(orgId, filters);
    }

    @Get(':id')
    @RequirePermission(PermissionName.VIEW_PROJECTS)
    async get(@Param('id') id: string) {
        return this.projects.list(id);
    }

    @Put(':id')
    @RequirePermission(PermissionName.EDIT_PROJECTS)
    async update(
        @Param('orgId') orgId: string,
        @Param('id') id: string,
        @Body() body: { name?: string; description?: string }
    ) {
        return this.projects.update(id, orgId, body);
    }

    @Delete(':id')
    @RequirePermission(PermissionName.DELETE_PROJECTS)
    async delete(@Param('orgId') orgId: string, @Param('id') id: string) {
        return this.projects.delete(id, orgId);
    }

    @Post(':id/link-integration')
    @RequirePermission(PermissionName.EDIT_PROJECTS)
    async link(
        @Param('id') id: string,
        @Body() body: { integrationId: string; items: any }
    ) {
        return this.projects.linkIntegration(id, body.integrationId, body.items);
    }

    @Get(':id/resources')
    @RequirePermission(PermissionName.VIEW_PROJECTS)
    async getAvailableResources(@Param('id') id: string) {
        return this.projects.getAvailableResources(id);
    }
}