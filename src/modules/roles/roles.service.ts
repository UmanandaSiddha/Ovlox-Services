import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { PermissionName } from 'generated/prisma/enums';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService {
    constructor(private readonly databaseService: DatabaseService) { }

    /**
     * Ensure permissions exist in database (sync PermissionName enum with Permissions table)
     */
    private async ensurePermissions() {
        const permissionNames = Object.values(PermissionName);
        
        for (const permName of permissionNames) {
            await this.databaseService.permissions.upsert({
                where: { code: permName },
                update: {},
                create: {
                    name: permName.replace(/_/g, ' ').toLowerCase(),
                    code: permName,
                    description: `Permission: ${permName}`,
                    scope: 'ORG', // All current permissions are org-level
                },
            });
        }
    }

    /**
     * Create role template
     */
    async createRoleTemplate(orgId: string, data: CreateRoleDto, createdById: string) {
        // Ensure permissions exist
        await this.ensurePermissions();

        // Check if role with same name already exists
        const existing = await this.databaseService.roleTemplate.findUnique({
            where: {
                organizationId_name: {
                    organizationId: orgId,
                    name: data.name,
                },
            },
        });

        if (existing) {
            throw new BadRequestException(`Role with name "${data.name}" already exists in this organization`);
        }

        const role = await this.databaseService.roleTemplate.create({
            data: {
                organizationId: orgId,
                name: data.name,
                description: data.description || undefined,
                createdById,
            },
            include: {
                rolePermissions: {
                    include: {
                        permission: true,
                    },
                },
            },
        });

        return role;
    }

    /**
     * Update role template
     */
    async updateRoleTemplate(roleId: string, data: UpdateRoleDto, userId: string) {
        const role = await this.databaseService.roleTemplate.findUnique({
            where: { id: roleId },
        });

        if (!role) {
            throw new NotFoundException(`Role ${roleId} not found`);
        }

        // Check name uniqueness if name is being updated
        if (data.name && data.name !== role.name) {
            const existing = await this.databaseService.roleTemplate.findUnique({
                where: {
                    organizationId_name: {
                        organizationId: role.organizationId,
                        name: data.name,
                    },
                },
            });

            if (existing && existing.id !== roleId) {
                throw new BadRequestException(`Role with name "${data.name}" already exists in this organization`);
            }
        }

        const updated = await this.databaseService.roleTemplate.update({
            where: { id: roleId },
            data: {
                name: data.name,
                description: data.description,
            },
            include: {
                rolePermissions: {
                    include: {
                        permission: true,
                    },
                },
            },
        });

        return updated;
    }

    /**
     * Delete role template
     */
    async deleteRoleTemplate(roleId: string, userId: string) {
        const role = await this.databaseService.roleTemplate.findUnique({
            where: { id: roleId },
        });

        if (!role) {
            throw new NotFoundException(`Role ${roleId} not found`);
        }

        // Check if role is assigned to any members
        const membersWithRole = await this.databaseService.organizationMember.count({
            where: { roleId },
        });

        if (membersWithRole > 0) {
            throw new BadRequestException('Cannot delete role that is assigned to members');
        }

        await this.databaseService.roleTemplate.delete({
            where: { id: roleId },
        });

        return { message: 'Role deleted successfully' };
    }

    /**
     * Assign permissions to role
     */
    async assignPermissionsToRole(roleId: string, permissionIds: string[], userId: string) {
        const role = await this.databaseService.roleTemplate.findUnique({
            where: { id: roleId },
        });

        if (!role) {
            throw new NotFoundException(`Role ${roleId} not found`);
        }

        // Verify all permissions exist
        const permissions = await this.databaseService.permissions.findMany({
            where: { id: { in: permissionIds } },
        });

        if (permissions.length !== permissionIds.length) {
            throw new BadRequestException('Some permissions not found');
        }

        // Remove existing permissions and add new ones
        await this.databaseService.$transaction(async (tx) => {
            await tx.roleTemplatePermission.deleteMany({
                where: { roleTemplateId: roleId },
            });

            await tx.roleTemplatePermission.createMany({
                data: permissionIds.map((permissionId) => ({
                    roleTemplateId: roleId,
                    permissionId,
                })),
            });
        });

        return this.getRoleTemplate(roleId);
    }

    /**
     * Remove permissions from role
     */
    async removePermissionsFromRole(roleId: string, permissionIds: string[], userId: string) {
        const role = await this.databaseService.roleTemplate.findUnique({
            where: { id: roleId },
        });

        if (!role) {
            throw new NotFoundException(`Role ${roleId} not found`);
        }

        await this.databaseService.roleTemplatePermission.deleteMany({
            where: {
                roleTemplateId: roleId,
                permissionId: { in: permissionIds },
            },
        });

        return this.getRoleTemplate(roleId);
    }

    /**
     * Assign role to member
     */
    async assignRoleToMember(orgId: string, memberId: string, roleId: string, assignedById: string) {
        const member = await this.databaseService.organizationMember.findUnique({
            where: { id: memberId },
        });

        if (!member || member.organizationId !== orgId) {
            throw new NotFoundException(`Member ${memberId} not found in organization`);
        }

        const role = await this.databaseService.roleTemplate.findUnique({
            where: { id: roleId },
        });

        if (!role || role.organizationId !== orgId) {
            throw new NotFoundException(`Role ${roleId} not found in organization`);
        }

        const updated = await this.databaseService.organizationMember.update({
            where: { id: memberId },
            data: {
                roleId,
                predefinedRole: null, // Clear predefined role when custom role is assigned
            },
            include: {
                role: {
                    include: {
                        rolePermissions: {
                            include: {
                                permission: true,
                            },
                        },
                    },
                },
            },
        });

        return updated;
    }

    /**
     * Get role templates
     */
    async getRoleTemplates(orgId: string) {
        const roles = await this.databaseService.roleTemplate.findMany({
            where: { organizationId: orgId },
            include: {
                rolePermissions: {
                    include: {
                        permission: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return roles;
    }

    /**
     * Get role template details
     */
    async getRoleTemplate(roleId: string) {
        const role = await this.databaseService.roleTemplate.findUnique({
            where: { id: roleId },
            include: {
                rolePermissions: {
                    include: {
                        permission: true,
                    },
                },
            },
        });

        if (!role) {
            throw new NotFoundException(`Role ${roleId} not found`);
        }

        return role;
    }

    /**
     * Get available permissions
     */
    async getAvailablePermissions() {
        // Ensure permissions exist
        await this.ensurePermissions();

        const permissions = await this.databaseService.permissions.findMany({
            orderBy: { code: 'asc' },
        });

        return permissions;
    }
}
