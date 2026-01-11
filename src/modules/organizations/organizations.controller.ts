import { Controller, Post, Body, UseGuards, Get, Param, Query, Sse, Header, Put, Delete } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorator/permission.decorator';
import { PermissionName } from 'generated/prisma/enums';
import { CreateOrgDto } from './dto/createOrg.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { UpdateOrgDto } from './dto/update-org.dto';
import { QueryString } from 'src/utils/apiFeatures';
import { interval, Observable, switchMap } from 'rxjs';

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
    async userOrgById(@getUser('id') userId: string, @Param('id') orgId: string) {
        return this.orgs.userOrgById(userId, orgId);
    }

    @Get('user/bySlug/:slug')
    async userOrgBySlug(@getUser('id') userId: string, @Param('slug') slug: string) {
        return this.orgs.userOrgBySlug(userId, slug);
    }

    @Put(':orgId')
    @UseGuards(PermissionGuard)
    @RequirePermission(PermissionName.MANAGE_ORG)
    async updateOrg(
        @Param('orgId') orgId: string,
        @getUser('id') userId: string,
        @Body() dto: UpdateOrgDto
    ) {
        return this.orgs.updateOrg(orgId, userId, dto);
    }

    @Delete(':orgId')
    @UseGuards(PermissionGuard)
    @RequirePermission(PermissionName.MANAGE_ORG)
    async deleteOrg(
        @Param('orgId') orgId: string,
        @getUser('id') userId: string
    ) {
        return this.orgs.deleteOrg(orgId, userId);
    }

    @Post(':orgId/members/invite')
    @UseGuards(PermissionGuard)
    @RequirePermission(PermissionName.INVITE_MEMBERS)
    async inviteMember(
        @Param('orgId') orgId: string,
        @getUser('id') inviterId: string,
        @Body() dto: InviteMemberDto
    ) {
        return this.orgs.inviteMember(orgId, inviterId, dto.email, dto.predefinedRole, dto.roleId);
    }

    @Get(':orgId/members')
    @UseGuards(PermissionGuard)
    @RequirePermission(PermissionName.VIEW_PROJECTS)
    async listMembers(
        @Param('orgId') orgId: string,
        @Query() filters: QueryString
    ) {
        return this.orgs.listMembers(orgId, filters);
    }

    @Put(':orgId/members/:memberId')
    @UseGuards(PermissionGuard)
    @RequirePermission(PermissionName.MANAGE_ROLES)
    async updateMemberRole(
        @Param('orgId') orgId: string,
        @Param('memberId') memberId: string,
        @Body() dto: UpdateMemberDto
    ) {
        return this.orgs.updateMemberRole(orgId, memberId, dto.predefinedRole, dto.roleId);
    }

    @Delete(':orgId/members/:memberId')
    @UseGuards(PermissionGuard)
    @RequirePermission(PermissionName.INVITE_MEMBERS)
    async removeMember(
        @Param('orgId') orgId: string,
        @Param('memberId') memberId: string
    ) {
        return this.orgs.removeMember(orgId, memberId);
    }

    @Get(':orgId/invites')
    @UseGuards(PermissionGuard)
    @RequirePermission(PermissionName.INVITE_MEMBERS)
    async listInvites(
        @Param('orgId') orgId: string,
        @Query() filters: QueryString
    ) {
        return this.orgs.listInvites(orgId, filters);
    }

    @Post('invites/:token/accept')
    @UseGuards()
    async acceptInvite(
        @Param('token') token: string,
        @getUser('id') userId: string
    ) {
        return this.orgs.acceptInvite(token, userId);
    }

    @Sse('integration/status/:slug')
    @Header('Cache-Control', 'no-cache')
    @Header('Content-Type', 'text/event-stream')
    @Header('Connection', 'keep-alive')
    integrationStatus(
        @getUser('id') userId: string,
        @Param('slug') slug: string
    ): Observable<MessageEvent> {
        return interval(5000).pipe(
            switchMap(async () => {
                const integrations = await this.orgs.integrationStatus(userId, slug);

                return {
                    data: integrations,
                } as MessageEvent;
            }),
        );
    }
}