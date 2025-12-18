import { Injectable } from '@nestjs/common';
import { ExternalProvider, IntegrationAuthType, IntegrationStatus, PredefinedOrgRole } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { CreateOrgDto } from './dto/createOrg.dto';
import { PrismaApiFeatures, QueryString } from 'src/utils/apiFeatures';
import { Prisma } from 'generated/prisma/client';

@Injectable()
export class OrganizationsService {
    constructor(
        private readonly databaseService: DatabaseService,
    ) { }

    async createOrg(ownerId: string, dto: CreateOrgDto) {
        const { name, inviteMembers, appProviders } = dto;

        const slug = name.toLowerCase().replace(/[^\w]+/g, '-').slice(0, 50);

        // TODO: EMAIL QUEUE PUSH FOR INVITING MEMBERS

        const organization = await this.databaseService.organization.create({
            data: {
                name,
                slug,
                ownerId,
                members: {
                    create: {
                        userId: ownerId,
                        predefinedRole: PredefinedOrgRole.OWNER
                    }
                },
                integrations: appProviders && {
                    createMany: {
                        data: appProviders.map(ap => ({
                            type: ap.provider,
                            authType:
                                ap.provider === ExternalProvider.GITHUB
                                    ? IntegrationAuthType.APP_JWT
                                    : IntegrationAuthType.OAUTH,
                            status: IntegrationStatus.NOT_CONNECTED
                        }))
                    }
                },
                invites: inviteMembers && {
                    createMany: {
                        data: inviteMembers.map(im => ({
                            email: im.email,
                            predefinedRole: im.predefinedRole,
                            invitedBy: ownerId,
                            token: crypto.randomUUID()
                        }))
                    }
                }
            },
        });

        return { message: "Organization Created Successfully", organization }
    }

    async userOrgs(userId: string, filters: QueryString) {
        const apiFeatures = new PrismaApiFeatures<
            Prisma.OrganizationWhereInput,
            Prisma.OrganizationInclude,
            Prisma.OrganizationOrderByWithRelationInput,
            typeof this.databaseService.organization
        >(this.databaseService.organization, filters)
            .where({ ownerId: userId })
            .search(['name'])
            .filter()
            .sort()
            .include({
                members: true,
                projects: true,
                integrations: true
            })
            .pagination();

        const { results: organizations, totalCount } = await apiFeatures.execute();

        const totalPages = Math.ceil(totalCount / (Number(filters.limit) || 10));

        return {
            success: true,
            count: organizations.length,
            totalCount,
            totalPages,
            data: organizations,
        }
    }

    async userOrgById(userId: string, orgId: string) {
        const organization = await this.databaseService.organization.findUnique({
            where: { id: orgId, ownerId: userId },
            include: {
                members: true,
                projects: true,
                integrations: true
            }
        });
        return { message: `Successfully Fetched Organization by Id ${orgId}`, organization }
    }
}