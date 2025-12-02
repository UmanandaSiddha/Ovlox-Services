import { Injectable } from '@nestjs/common';
import { PredefinedOrgRole } from '@prisma/client';
import { nanoid } from 'nanoid';
import { DatabaseService } from 'src/services/database/database.service';

@Injectable()
export class OrganizationsService {
    constructor(
        private readonly databaseService: DatabaseService,
    ) { }

    async createOrg(ownerId: string, name: string) {
        const slug = name.toLowerCase().replace(/[^\w]+/g, '-').slice(0, 50);
        return this.databaseService.organization.create({
            data: {
                name,
                slug,
                ownerId,
            },
        });
    }

    async invite(orgId: string, email: string, role: string, invitedBy: string) {
        const token = nanoid(32);
        return this.databaseService.invite.create({
            data: {
                organizationId: orgId,
                email,
                role,
                invitedBy,
                token,
            },
        });
    }

    async acceptInvite(token: string, userId: string) {
        const invite = await this.databaseService.invite.findUnique({ where: { token } });
        if (!invite) throw new Error('Invalid invite');
        if (invite.status !== 'pending') throw new Error('Invite not pending');

        const member = await this.databaseService.organizationMember.create({
            data: {
                organizationId: invite.organizationId,
                userId,
                predefinedRole: invite.role as PredefinedOrgRole,
                status: 'active',
            },
        });

        await this.databaseService.invite.update({ where: { id: invite.id }, data: { status: 'accepted', userId } });
        return member;
    }

    async listOrgsForUser(userId: string) {
        return this.databaseService.organizationMember.findMany({ where: { userId }, include: { organization: true } });
    }
}