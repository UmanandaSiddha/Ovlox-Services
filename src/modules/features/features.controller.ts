import {
    Controller,
    Post,
    Get,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
} from '@nestjs/common';
import { FeaturesService } from './features.service';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorator/permission.decorator';
import { PermissionName, FeatureStatus } from 'generated/prisma/enums';
import { CreateFeatureDto } from './dto/create-feature.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';
import { LinkFeatureEventDto } from './dto/link-event.dto';

@Controller('orgs/:orgId/projects/:projectId/features')
@UseGuards(AuthGuard, PermissionGuard)
export class FeaturesController {
    constructor(private readonly featuresService: FeaturesService) { }

    @Post()
    @RequirePermission(PermissionName.CREATE_PROJECTS)
    async createFeature(
        @Param('projectId') projectId: string,
        @Body() dto: CreateFeatureDto,
        @getUser('id') userId: string,
    ) {
        return this.featuresService.createFeature(projectId, dto, userId);
    }

    @Get()
    @RequirePermission(PermissionName.VIEW_PROJECTS)
    async getFeatures(
        @Param('projectId') projectId: string,
        @Query('status') status?: FeatureStatus,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        return this.featuresService.getFeatures(projectId, {
            status: status as FeatureStatus,
            limit: limit ? parseInt(limit) : 50,
            offset: offset ? parseInt(offset) : 0,
        });
    }

    @Get(':id')
    @RequirePermission(PermissionName.VIEW_PROJECTS)
    async getFeature(@Param('id') id: string) {
        return this.featuresService.getFeature(id);
    }

    @Put(':id')
    @RequirePermission(PermissionName.EDIT_PROJECTS)
    async updateFeature(
        @Param('id') id: string,
        @Body() dto: UpdateFeatureDto,
        @getUser('id') userId: string,
    ) {
        return this.featuresService.updateFeature(id, dto, userId);
    }

    @Delete(':id')
    @RequirePermission(PermissionName.DELETE_PROJECTS)
    async deleteFeature(@Param('id') id: string, @getUser('id') userId: string) {
        return this.featuresService.deleteFeature(id, userId);
    }

    @Put(':id/status')
    @RequirePermission(PermissionName.EDIT_PROJECTS)
    async updateFeatureStatus(
        @Param('id') id: string,
        @Body() body: { status: FeatureStatus },
        @getUser('id') userId: string,
    ) {
        return this.featuresService.updateFeatureStatus(id, body.status, userId);
    }

    @Post(':id/link-event')
    @RequirePermission(PermissionName.EDIT_PROJECTS)
    async linkRawEvent(@Param('id') id: string, @Body() dto: LinkFeatureEventDto) {
        return this.featuresService.linkRawEventToFeature(id, dto.rawEventId, dto.relevance);
    }
}
