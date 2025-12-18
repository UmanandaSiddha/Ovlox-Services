import { Controller, Post, Body, UseGuards, Get, Param, Query } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { CreateOrgDto } from './dto/createOrg.dto';
import { QueryString } from 'src/utils/apiFeatures';

@Controller('orgs')
@UseGuards(AuthGuard, RoleGuard)
export class OrganizationsController {
    constructor(private orgs: OrganizationsService) { }

    @UseGuards()
    @Post('create')
    async create(@getUser('id') userId: string, @Body() dto: CreateOrgDto) {
        return this.orgs.createOrg(userId, dto);
    }

    @Get('user')
    async userOrgs(@getUser('id') userId: string, @Query() filters: QueryString) {
        return this.orgs.userOrgs(userId, filters);
    }

    @Get('user/byId/:id')
    async myOrgs(@getUser('id') userId: string, @Param('id') orgId: string) {
        return this.orgs.userOrgById(userId, orgId);
    }
}