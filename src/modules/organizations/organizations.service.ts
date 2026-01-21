import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ExternalProvider, IntegrationAuthType, IntegrationStatus, PredefinedOrgRole, InviteStatus, OrgMemberStatus } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { CreateOrgDto } from './dto/createOrg.dto';
import { PrismaApiFeatures, QueryString } from 'src/utils/apiFeatures';
import { Prisma } from 'generated/prisma/client';
import { RedisService } from 'src/services/redis/redis.service';
import { REDIS_ORG_APP_INTEGRATION_STATUS_KEY_PREFIX } from 'src/config/constants';
import { EmailQueue } from 'src/services/queue/email.queue';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class OrganizationsService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly redisService: RedisService,
        private readonly emailQueue: EmailQueue,
        private readonly configService: ConfigService
    ) { }

    async createOrg(ownerId: string, dto: CreateOrgDto) {
        const { name, inviteMembers, appProviders } = dto;

        const slug = name.toLowerCase().replace(/[^\w]+/g, '-').slice(0, 50);

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

        // Send invite emails
        if (inviteMembers && inviteMembers.length > 0) {
            const FRONTEND_URL = this.configService.get<string>('FRONTEND_URL');
            for (const invite of inviteMembers) {
                const inviteRecord = await this.databaseService.invite.findFirst({
                    where: {
                        organizationId: organization.id,
                        email: invite.email
                    }
                });
                if (inviteRecord) {
                    const inviteUrl = `${FRONTEND_URL}/invites/accept?token=${inviteRecord.token}`;
                    await this.emailQueue.enqueue({
                        to: invite.email,
                        subject: `Invitation to join ${name}`,
                        template: 'invite',
                        data: {
                            organizationName: name,
                            inviteUrl,
                        }
                    });
                }
            }
        }

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

    async userOrgBySlug(userId: string, slug: string) {
        const organization = await this.databaseService.organization.findUnique({
            where: { slug, ownerId: userId },
            include: {
                members: {
                    include: {
                        user: true
                    }
                },
                projects: true,
                integrations: true
            }
        });
        if (!organization) return null;

        return { message: `Successfully Fetched Organization by Slug ${slug}`, organization }
    }

    async userOrgById(userId: string, orgId: string) {
        const organization = await this.databaseService.organization.findUnique({
            where: { id: orgId, ownerId: userId },
            include: {
                members: {
                    include: {
                        user: true
                    }
                },
                projects: true,
                integrations: true
            }
        });
        if (!organization) return null;

        return { message: `Successfully Fetched Organization by Id ${orgId}`, organization }
    }

    async integrationStatus(userId: string, slug: string) {
        const key = `${REDIS_ORG_APP_INTEGRATION_STATUS_KEY_PREFIX}-${slug}`
        const cachedIntegrations = await this.redisService.get(key);
        if (cachedIntegrations) {
            // Return cached array as-is
            return JSON.parse(cachedIntegrations);
        }

        const organization = await this.databaseService.organization.findUnique({
            where: { slug, ownerId: userId },
            include: {
                integrations: true,
                providers: true
            }
        });
        if (!organization) return [];

        const integrations = await this.buildIntegrationStatusEntries(organization);

        await this.redisService.set(
            key,
            JSON.stringify(integrations),
            60 * 60
        )

        // Return a flat array of integration status objects
        return integrations;
    }

    private async buildIntegrationStatusEntries(organization: any, onlyIntegrationId?: string) {
        const twoStepIntegrations: ExternalProvider[] = [ExternalProvider.GITHUB];

        const orgGithubProvider = organization.providers?.find(
            (p: any) => p.provider === ExternalProvider.GITHUB && p.organizationId === organization.id
        );

        // Pre-compute auto-connect candidates (only relevant when org has GitHub OAuth connected)
        let githubAutoConnectCandidates: any[] = [];
        if (orgGithubProvider?.providerUserId) {
            const otherOrgs = await this.databaseService.organization.findMany({
                where: {
                    ownerId: organization.ownerId,
                    id: { not: organization.id },
                    providers: {
                        some: {
                            provider: ExternalProvider.GITHUB,
                            providerUserId: orgGithubProvider.providerUserId,
                        },
                    },
                    integrations: {
                        some: {
                            type: ExternalProvider.GITHUB,
                            status: IntegrationStatus.CONNECTED,
                        },
                    },
                },
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    providers: {
                        where: { provider: ExternalProvider.GITHUB },
                        select: { providerUserId: true, identifier: true },
                        take: 1,
                    },
                    integrations: {
                        where: { type: ExternalProvider.GITHUB },
                        select: {
                            id: true,
                            status: true,
                            externalAccountId: true,
                            externalAccount: true,
                        },
                        take: 1,
                    },
                },
            });

            githubAutoConnectCandidates = otherOrgs
                .filter((o) => o.integrations?.[0]?.externalAccountId)
                .map((o) => ({
                    orgId: o.id,
                    orgSlug: o.slug,
                    orgName: o.name,
                    integrationId: o.integrations?.[0]?.id,
                    status: o.integrations?.[0]?.status,
                    externalAccountId: o.integrations?.[0]?.externalAccountId,
                    externalAccount: o.integrations?.[0]?.externalAccount,
                    oauthAccount: o.providers?.[0]
                        ? {
                            providerUserId: o.providers[0].providerUserId,
                            identifier: o.providers[0].identifier,
                        }
                        : null,
                }));
        }

        const integrations = (organization.integrations || [])
            .filter((i: any) => !onlyIntegrationId || i.id === onlyIntegrationId)
            .map((integration: any) => {
                const baseData: any = {
                    app: integration.type,
                    authType: integration.authType,
                    status: integration.status,
                    integrationId: integration.id,
                    externalAccountId: integration.externalAccountId,
                    externalAccount: integration.externalAccount,
                };

                if (twoStepIntegrations.includes(integration.type as ExternalProvider)) {
                    const provider = organization.providers.find(
                        (p: any) => p.provider === integration.type && p.organizationId === organization.id
                    );

                    baseData.oauthStatus = provider ? 'CONNECTED' : 'NOT_CONNECTED';
                    baseData.oauthConnectedAt = provider?.createdAt || null;
                    baseData.oauthAccount = provider ? {
                        identifier: provider.identifier,
                        providerUserId: provider.providerUserId,
                    } : null;

                    const isNotConnected =
                        integration.status === IntegrationStatus.NOT_CONNECTED &&
                        !integration.externalAccountId;

                    baseData.canAutoConnect = !!provider && isNotConnected && githubAutoConnectCandidates.length > 0;
                    baseData.autoConnectCandidates = baseData.canAutoConnect ? githubAutoConnectCandidates : [];

                    if (!provider && integration.status === IntegrationStatus.NOT_CONNECTED) {
                        baseData.statusMessage = 'OAuth not connected';
                    } else if (provider && integration.status === IntegrationStatus.NOT_CONNECTED && !integration.externalAccountId) {
                        baseData.statusMessage =
                            baseData.canAutoConnect
                                ? 'OAuth connected, app already installed in another org'
                                : 'OAuth connected, installation pending';
                    } else if (provider && integration.status === IntegrationStatus.PROCESSING) {
                        baseData.statusMessage = 'OAuth connected, installation processing';
                    } else if (provider && integration.status === IntegrationStatus.CONNECTED) {
                        baseData.statusMessage = 'Fully connected';
                    } else {
                        baseData.statusMessage = integration.status === IntegrationStatus.CONNECTED
                            ? 'Connected'
                            : integration.status === IntegrationStatus.PROCESSING
                                ? 'Processing'
                                : 'Not connected';
                    }
                } else {
                    baseData.statusMessage = integration.status === IntegrationStatus.CONNECTED
                        ? 'Connected'
                        : integration.status === IntegrationStatus.PROCESSING
                            ? 'Processing'
                            : 'Not connected';
                }

                if (integration.config) {
                    baseData.config = integration.config;
                }

                return baseData;
            });

        return integrations;
    }

    async listIntegrationsByOrgId(userId: string, orgId: string) {
        // Check if user has access to this organization (owner or member)
        const organization = await this.databaseService.organization.findFirst({
            where: {
                id: orgId,
                OR: [
                    { ownerId: userId },
                    {
                        members: {
                            some: {
                                userId,
                                status: OrgMemberStatus.ACTIVE
                            }
                        }
                    }
                ]
            },
            include: {
                integrations: true,
                providers: true
            }
        });

        if (!organization) {
            throw new NotFoundException('Organization not found or access denied');
        }

        // Use the same logic as integrationStatus but with orgId
        const key = `${REDIS_ORG_APP_INTEGRATION_STATUS_KEY_PREFIX}-${organization.slug}`;
        const cachedIntegrations = await this.redisService.get(key);
        if (cachedIntegrations) {
            return JSON.parse(cachedIntegrations);
        }

        const integrations = await this.buildIntegrationStatusEntries(organization);

        await this.redisService.set(
            key,
            JSON.stringify(integrations),
            60 * 60
        );

        return integrations;
    }

    async getIntegrationStatusById(userId: string, orgId: string, integrationId: string) {
        // Check if user has access to this organization (owner or member)
        const organization = await this.databaseService.organization.findFirst({
            where: {
                id: orgId,
                OR: [
                    { ownerId: userId },
                    {
                        members: {
                            some: {
                                userId,
                                status: OrgMemberStatus.ACTIVE
                            }
                        }
                    }
                ]
            },
            include: {
                integrations: {
                    where: { id: integrationId }
                },
                providers: true
            }
        });

        if (!organization) {
            throw new NotFoundException('Organization not found or access denied');
        }

        const integration = organization.integrations[0];
        if (!integration) {
            throw new NotFoundException('Integration not found');
        }

        const entries = await this.buildIntegrationStatusEntries(organization, integrationId);
        return entries[0];
    }

    async githubAutoConnect(userId: string, orgId: string, sourceOrgId: string) {
        const [destOrg, srcOrg] = await Promise.all([
            this.databaseService.organization.findFirst({
                where: {
                    id: orgId,
                    OR: [
                        { ownerId: userId },
                        {
                            members: {
                                some: {
                                    userId,
                                    status: OrgMemberStatus.ACTIVE
                                }
                            }
                        }
                    ]
                },
                include: {
                    providers: { where: { provider: ExternalProvider.GITHUB } },
                    integrations: { where: { type: ExternalProvider.GITHUB } },
                }
            }),
            this.databaseService.organization.findUnique({
                where: { id: sourceOrgId },
                include: {
                    providers: { where: { provider: ExternalProvider.GITHUB } },
                    integrations: { where: { type: ExternalProvider.GITHUB } },
                }
            })
        ]);

        if (!destOrg) throw new NotFoundException('Organization not found or access denied');
        if (!srcOrg) throw new NotFoundException('Source organization not found');
        if (destOrg.ownerId !== srcOrg.ownerId) {
            throw new BadRequestException('Source org must have same owner');
        }

        const destProvider = destOrg.providers?.[0];
        const srcProvider = srcOrg.providers?.[0];
        if (!destProvider || !srcProvider) {
            throw new BadRequestException('GitHub OAuth must be connected on both orgs');
        }
        if (destProvider.providerUserId !== srcProvider.providerUserId) {
            throw new BadRequestException('GitHub OAuth identity must match');
        }

        const srcIntegration = srcOrg.integrations?.[0];
        if (!srcIntegration?.externalAccountId || srcIntegration.status !== IntegrationStatus.CONNECTED) {
            throw new BadRequestException('Source org GitHub app is not installed');
        }

        const destIntegration = destOrg.integrations?.[0];
        if (!destIntegration) {
            throw new NotFoundException('Destination GitHub integration not found');
        }

        const destConfig = (destIntegration.config || {}) as any;
        delete destConfig.token;
        delete destConfig.expiresAt;

        const updated = await this.databaseService.integration.update({
            where: { id: destIntegration.id },
            data: {
                status: IntegrationStatus.CONNECTED,
                externalAccountId: srcIntegration.externalAccountId,
                externalAccount: srcIntegration.externalAccount,
                config: destConfig,
            }
        });

        // Invalidate caches for all orgs under this owner+github identity (best-effort)
        const orgsToInvalidate = await this.databaseService.organization.findMany({
            where: {
                ownerId: destOrg.ownerId,
                providers: {
                    some: {
                        provider: ExternalProvider.GITHUB,
                        providerUserId: destProvider.providerUserId,
                    }
                }
            },
            select: { slug: true },
        });
        const keys = orgsToInvalidate
            .map((o) => o.slug)
            .filter(Boolean)
            .map((slug) => `${REDIS_ORG_APP_INTEGRATION_STATUS_KEY_PREFIX}-${slug}`);
        if (keys.length > 0) {
            await this.redisService.del(...keys);
        }

        return {
            message: 'GitHub auto-connect successful',
            integration: updated,
            source: {
                orgId: srcOrg.id,
                orgSlug: srcOrg.slug,
                integrationId: srcIntegration.id,
                externalAccountId: srcIntegration.externalAccountId,
                externalAccount: srcIntegration.externalAccount,
            }
        };
    }

    async updateOrg(orgId: string, userId: string, data: { name?: string }) {
        const org = await this.databaseService.organization.findFirst({
            where: { id: orgId, ownerId: userId }
        });
        if (!org) throw new NotFoundException('Organization not found');

        const updateData: any = {};
        if (data.name) {
            updateData.name = data.name;
            updateData.slug = data.name.toLowerCase().replace(/[^\w]+/g, '-').slice(0, 50);
        }

        return this.databaseService.organization.update({
            where: { id: orgId },
            data: updateData,
        });
    }

    async deleteOrg(orgId: string, userId: string) {
        const org = await this.databaseService.organization.findFirst({
            where: { id: orgId, ownerId: userId }
        });
        if (!org) throw new NotFoundException('Organization not found');

        await this.databaseService.organization.delete({
            where: { id: orgId }
        });
        return { message: 'Organization deleted successfully' };
    }

    async inviteMember(orgId: string, inviterId: string, email: string, predefinedRole?: PredefinedOrgRole, roleId?: string) {
        const org = await this.databaseService.organization.findUnique({
            where: { id: orgId }
        });
        if (!org) throw new NotFoundException('Organization not found');

        // Check if user already exists
        const user = await this.databaseService.user.findUnique({
            where: { email }
        });

        // Check if already a member
        if (user) {
            const existingMember = await this.databaseService.organizationMember.findFirst({
                where: { organizationId: orgId, userId: user.id }
            });
            if (existingMember) {
                throw new BadRequestException('User is already a member of this organization');
            }
        }

        // Check if invite already exists
        const existingInvite = await this.databaseService.invite.findFirst({
            where: { organizationId: orgId, email, status: InviteStatus.PENDING }
        });
        if (existingInvite) {
            throw new BadRequestException('Invite already sent to this email');
        }

        const token = crypto.randomUUID();
        const invite = await this.databaseService.invite.create({
            data: {
                organizationId: orgId,
                email,
                predefinedRole,
                roleId,
                invitedBy: inviterId,
                token,
                userId: user?.id,
            }
        });

        // Send invite email
        const FRONTEND_URL = this.configService.get<string>('FRONTEND_URL');
        const inviteUrl = `${FRONTEND_URL}/invites/accept?token=${token}`;
        
        await this.emailQueue.enqueue({
            to: email,
            subject: `Invitation to join ${org.name}`,
            template: 'invite',
            data: {
                organizationName: org.name,
                inviteUrl,
            }
        });

        return invite;
    }

    async acceptInvite(token: string, userId: string) {
        const invite = await this.databaseService.invite.findUnique({
            where: { token },
            include: { organization: true }
        });

        if (!invite) throw new NotFoundException('Invite not found');
        if (invite.status !== InviteStatus.PENDING) {
            throw new BadRequestException('Invite has already been processed');
        }

        // Verify user email matches invite email
        const user = await this.databaseService.user.findUnique({
            where: { id: userId }
        });
        if (!user || user.email !== invite.email) {
            throw new BadRequestException('Email does not match invite');
        }

        // Check if already a member
        const existingMember = await this.databaseService.organizationMember.findFirst({
            where: { organizationId: invite.organizationId, userId }
        });
        if (existingMember) {
            throw new BadRequestException('User is already a member');
        }

        // Create member and update invite
        await this.databaseService.$transaction([
            this.databaseService.organizationMember.create({
                data: {
                    organizationId: invite.organizationId,
                    userId,
                    predefinedRole: invite.predefinedRole,
                    roleId: invite.roleId,
                    invitedBy: invite.invitedBy,
                    status: OrgMemberStatus.ACTIVE,
                }
            }),
            this.databaseService.invite.update({
                where: { id: invite.id },
                data: {
                    status: InviteStatus.ACCEPTED,
                    userId,
                }
            })
        ]);

        return { message: 'Invite accepted successfully' };
    }

    async listInvites(orgId: string, filters: QueryString) {
        const apiFeatures = new PrismaApiFeatures<
            Prisma.InviteWhereInput,
            Prisma.InviteInclude,
            Prisma.InviteOrderByWithRelationInput,
            typeof this.databaseService.invite
        >(this.databaseService.invite, filters)
            .where({ organizationId: orgId })
            .search(['email'])
            .filter()
            .sort()
            .pagination();

        const { results: invites, totalCount } = await apiFeatures.execute();

        return {
            success: true,
            count: invites.length,
            totalCount,
            totalPages: Math.ceil(totalCount / (Number(filters.limit) || 10)),
            data: invites,
        };
    }

    async listMembers(orgId: string, filters: QueryString) {
        const apiFeatures = new PrismaApiFeatures<
            Prisma.OrganizationMemberWhereInput,
            Prisma.OrganizationMemberInclude,
            Prisma.OrganizationMemberOrderByWithRelationInput,
            typeof this.databaseService.organizationMember
        >(this.databaseService.organizationMember, filters)
            .where({ organizationId: orgId, status: OrgMemberStatus.ACTIVE })
            .include({
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true
                    }
                },
                role: {
                    include: {
                        rolePermissions: {
                            include: {
                                permission: true
                            }
                        }
                    }
                }
            })
            .pagination();

        const { results: members, totalCount } = await apiFeatures.execute();

        return {
            success: true,
            count: members.length,
            totalCount,
            totalPages: Math.ceil(totalCount / (Number(filters.limit) || 10)),
            data: members,
        };
    }

    async updateMemberRole(orgId: string, memberId: string, predefinedRole?: PredefinedOrgRole, roleId?: string) {
        const member = await this.databaseService.organizationMember.findFirst({
            where: { id: memberId, organizationId: orgId }
        });
        if (!member) throw new NotFoundException('Member not found');

        // Cannot change owner role
        if (member.predefinedRole === PredefinedOrgRole.OWNER) {
            throw new BadRequestException('Cannot change owner role');
        }

        return this.databaseService.organizationMember.update({
            where: { id: memberId },
            data: {
                predefinedRole,
                roleId,
            }
        });
    }

    async removeMember(orgId: string, memberId: string) {
        const member = await this.databaseService.organizationMember.findFirst({
            where: { id: memberId, organizationId: orgId }
        });
        if (!member) throw new NotFoundException('Member not found');

        // Cannot remove owner
        if (member.predefinedRole === PredefinedOrgRole.OWNER) {
            throw new BadRequestException('Cannot remove organization owner');
        }

        await this.databaseService.organizationMember.delete({
            where: { id: memberId }
        });

        return { message: 'Member removed successfully' };
    }
}