import { Injectable, ForbiddenException } from '@nestjs/common';
import { PermissionName, PredefinedOrgRole } from '@prisma/client';
import { OrgMemberStatus } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';

const PREDEFINED_PERMISSIONS: Record<PredefinedOrgRole, PermissionName[]> = {
    OWNER: ['MANAGE_ORG', 'INVITE_MEMBERS', 'MANAGE_INTEGRATIONS', 'CREATE_PROJECTS', 'EDIT_PROJECTS', 'DELETE_PROJECTS', 'VIEW_PROJECTS', 'MANAGE_ROLES', 'MAP_IDENTITIES', 'RUN_IMPORTS', 'VIEW_REPORTS', 'MANAGE_TASKS', 'MANAGE_WEBHOOKS', 'EXPORT_DATA'],
    ADMIN: ['MANAGE_ORG', 'INVITE_MEMBERS', 'MANAGE_INTEGRATIONS', 'CREATE_PROJECTS', 'EDIT_PROJECTS', 'VIEW_PROJECTS', 'RUN_IMPORTS', 'VIEW_REPORTS', 'MANAGE_TASKS', 'EXPORT_DATA'],
    DEVELOPER: ['VIEW_PROJECTS', 'MANAGE_TASKS', 'RUN_IMPORTS'],
    VIEWER: ['VIEW_PROJECTS', 'VIEW_REPORTS'],
    CEO: ['VIEW_PROJECTS', 'VIEW_REPORTS', 'EXPORT_DATA'],
    CTO: ['VIEW_PROJECTS', 'VIEW_REPORTS', 'EXPORT_DATA'],
};

@Injectable()
export class AuthorizationService {
    constructor(private databaseService: DatabaseService) { }

    async assertOrgPermission(userId: string, orgId: string, permission: PermissionName) {
        const org = await this.databaseService.organization.findUnique({
            where: { id: orgId },
            select: { ownerId: true },
        });

        if (!org) throw new ForbiddenException('Organization not found');

        if (org.ownerId === userId) return true;

        const member = await this.databaseService.organizationMember.findFirst({
            where: { userId, organizationId: orgId, status: OrgMemberStatus.ACTIVE },
        });

        if (!member || !member.predefinedRole) {
            throw new ForbiddenException('Not part of organization');
        }

        const can = PREDEFINED_PERMISSIONS[member.predefinedRole]?.includes(permission);
        if (!can) throw new ForbiddenException(`Missing permission: ${permission}`);

        return true;
    }
}