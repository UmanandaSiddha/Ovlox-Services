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
import { ContributorsService } from './contributors.service';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorator/permission.decorator';
import { PermissionName } from 'generated/prisma/enums';
import { CreateContributorMapDto } from './dto/create-contributor-map.dto';
import { UpdateContributorMapDto } from './dto/update-contributor-map.dto';

@Controller('orgs/:orgId/contributors')
@UseGuards(AuthGuard, PermissionGuard)
export class ContributorsController {
    constructor(private readonly contributorsService: ContributorsService) { }

    @Post('maps')
    @RequirePermission(PermissionName.MAP_IDENTITIES)
    async createContributorMap(
        @Param('orgId') orgId: string,
        @Body() dto: CreateContributorMapDto,
        @getUser('id') userId: string,
    ) {
        return this.contributorsService.createContributorMap(orgId, dto, userId);
    }

    @Get('maps')
    @RequirePermission(PermissionName.MAP_IDENTITIES)
    async getContributorMaps(
        @Param('orgId') orgId: string,
        @Query('memberId') memberId?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        return this.contributorsService.getContributorMaps(orgId, {
            memberId,
            limit: limit ? parseInt(limit) : 50,
            offset: offset ? parseInt(offset) : 0,
        });
    }

    @Get('maps/:id')
    @RequirePermission(PermissionName.MAP_IDENTITIES)
    async getContributorMap(@Param('id') id: string) {
        return this.contributorsService.getContributorMap(id);
    }

    @Put('maps/:id')
    @RequirePermission(PermissionName.MAP_IDENTITIES)
    async updateContributorMap(
        @Param('id') id: string,
        @Body() dto: UpdateContributorMapDto,
        @getUser('id') userId: string,
    ) {
        return this.contributorsService.updateContributorMap(id, dto, userId);
    }

    @Delete('maps/:id')
    @RequirePermission(PermissionName.MAP_IDENTITIES)
    async deleteContributorMap(@Param('id') id: string, @getUser('id') userId: string) {
        return this.contributorsService.deleteContributorMap(id, userId);
    }

    @Get('identities/unmapped')
    @RequirePermission(PermissionName.MAP_IDENTITIES)
    async getUnmappedIdentities(@Param('orgId') orgId: string) {
        return this.contributorsService.getUnmappedIdentities(orgId);
    }
}
