import {
    Controller,
    Post,
    Get,
    Put,
    Delete,
    Body,
    Param,
    UseGuards,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorator/permission.decorator';
import { PermissionName } from 'generated/prisma/enums';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';
import { AssignRoleDto } from './dto/assign-role.dto';

@Controller('orgs/:orgId/roles')
@UseGuards(AuthGuard, PermissionGuard)
export class RolesController {
    constructor(private readonly rolesService: RolesService) { }

    @Post()
    @RequirePermission(PermissionName.MANAGE_ROLES)
    async createRole(
        @Param('orgId') orgId: string,
        @Body() dto: CreateRoleDto,
        @getUser('id') userId: string,
    ) {
        return this.rolesService.createRoleTemplate(orgId, dto, userId);
    }

    @Get()
    @RequirePermission(PermissionName.MANAGE_ROLES)
    async getRoles(@Param('orgId') orgId: string) {
        return this.rolesService.getRoleTemplates(orgId);
    }

    @Get(':id')
    @RequirePermission(PermissionName.MANAGE_ROLES)
    async getRole(@Param('id') id: string) {
        return this.rolesService.getRoleTemplate(id);
    }

    @Put(':id')
    @RequirePermission(PermissionName.MANAGE_ROLES)
    async updateRole(
        @Param('id') id: string,
        @Body() dto: UpdateRoleDto,
        @getUser('id') userId: string,
    ) {
        return this.rolesService.updateRoleTemplate(id, dto, userId);
    }

    @Delete(':id')
    @RequirePermission(PermissionName.MANAGE_ROLES)
    async deleteRole(@Param('id') id: string, @getUser('id') userId: string) {
        return this.rolesService.deleteRoleTemplate(id, userId);
    }

    @Post(':id/permissions')
    @RequirePermission(PermissionName.MANAGE_ROLES)
    async assignPermissions(
        @Param('id') id: string,
        @Body() dto: AssignPermissionsDto,
        @getUser('id') userId: string,
    ) {
        return this.rolesService.assignPermissionsToRole(id, dto.permissionIds, userId);
    }

    @Delete(':id/permissions')
    @RequirePermission(PermissionName.MANAGE_ROLES)
    async removePermissions(
        @Param('id') id: string,
        @Body() dto: AssignPermissionsDto,
        @getUser('id') userId: string,
    ) {
        return this.rolesService.removePermissionsFromRole(id, dto.permissionIds, userId);
    }

    @Get('permissions/available')
    @RequirePermission(PermissionName.MANAGE_ROLES)
    async getAvailablePermissions() {
        return this.rolesService.getAvailablePermissions();
    }

    @Post('assign/:memberId')
    @RequirePermission(PermissionName.MANAGE_ROLES)
    async assignRole(
        @Param('orgId') orgId: string,
        @Param('memberId') memberId: string,
        @Body() dto: AssignRoleDto,
        @getUser('id') userId: string,
    ) {
        return this.rolesService.assignRoleToMember(orgId, memberId, dto.roleId, userId);
    }
}
