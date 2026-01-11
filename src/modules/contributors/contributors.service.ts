import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { CreateContributorMapDto } from './dto/create-contributor-map.dto';
import { UpdateContributorMapDto } from './dto/update-contributor-map.dto';

@Injectable()
export class ContributorsService {
    constructor(private readonly databaseService: DatabaseService) { }

    /**
     * Create contributor map
     */
    async createContributorMap(orgId: string, data: CreateContributorMapDto, mappedById: string) {
        // Verify identity belongs to organization
        const identity = await this.databaseService.identity.findUnique({
            where: { id: data.identityId },
        });

        if (!identity || identity.organizationId !== orgId) {
            throw new NotFoundException(`Identity ${data.identityId} not found in organization`);
        }

        // Verify member belongs to organization
        const member = await this.databaseService.organizationMember.findUnique({
            where: { id: data.memberId },
        });

        if (!member || member.organizationId !== orgId) {
            throw new NotFoundException(`Member ${data.memberId} not found in organization`);
        }

        // Check if mapping already exists
        const existing = await this.databaseService.contributorMap.findUnique({
            where: {
                uq_contributor_map_org_identity: {
                    organizationId: orgId,
                    identityId: data.identityId,
                },
            },
        });

        if (existing) {
            throw new BadRequestException('Contributor map already exists for this identity');
        }

        const map = await this.databaseService.contributorMap.create({
            data: {
                organizationId: orgId,
                identityId: data.identityId,
                memberId: data.memberId,
                mappedById,
            },
            include: {
                identity: true,
                member: {
                    include: { user: true },
                },
            },
        });

        return map;
    }

    /**
     * Update contributor map
     */
    async updateContributorMap(mapId: string, data: UpdateContributorMapDto, userId: string) {
        const map = await this.databaseService.contributorMap.findUnique({
            where: { id: mapId },
        });

        if (!map) {
            throw new NotFoundException(`Contributor map ${mapId} not found`);
        }

        // Verify member belongs to same organization
        const member = await this.databaseService.organizationMember.findUnique({
            where: { id: data.memberId },
        });

        if (!member || member.organizationId !== map.organizationId) {
            throw new NotFoundException(`Member ${data.memberId} not found in organization`);
        }

        const updated = await this.databaseService.contributorMap.update({
            where: { id: mapId },
            data: {
                memberId: data.memberId,
            },
            include: {
                identity: true,
                member: {
                    include: { user: true },
                },
            },
        });

        return updated;
    }

    /**
     * Delete contributor map
     */
    async deleteContributorMap(mapId: string, userId: string) {
        const map = await this.databaseService.contributorMap.findUnique({
            where: { id: mapId },
        });

        if (!map) {
            throw new NotFoundException(`Contributor map ${mapId} not found`);
        }

        await this.databaseService.contributorMap.delete({
            where: { id: mapId },
        });

        return { message: 'Contributor map deleted successfully' };
    }

    /**
     * Get unmapped identities
     */
    async getUnmappedIdentities(orgId: string) {
        const mappedIdentityIds = await this.databaseService.contributorMap.findMany({
            where: { organizationId: orgId },
            select: { identityId: true },
        });

        const mappedIds = mappedIdentityIds.map((m) => m.identityId);

        const unmapped = await this.databaseService.identity.findMany({
            where: {
                organizationId: orgId,
                id: {
                    notIn: mappedIds,
                },
            },
            include: {
                rawEvents: {
                    take: 5,
                    orderBy: { timestamp: 'desc' },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return unmapped;
    }

    /**
     * Get contributor maps
     */
    async getContributorMaps(
        orgId: string,
        filters: {
            memberId?: string;
            limit?: number;
            offset?: number;
        },
    ) {
        const maps = await this.databaseService.contributorMap.findMany({
            where: {
                organizationId: orgId,
                ...(filters.memberId ? { memberId: filters.memberId } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: filters.limit || 50,
            skip: filters.offset || 0,
            include: {
                identity: true,
                member: {
                    include: { user: true },
                },
            },
        });

        return maps;
    }

    /**
     * Get contributor map details
     */
    async getContributorMap(mapId: string) {
        const map = await this.databaseService.contributorMap.findUnique({
            where: { id: mapId },
            include: {
                identity: true,
                member: {
                    include: { user: true },
                },
            },
        });

        if (!map) {
            throw new NotFoundException(`Contributor map ${mapId} not found`);
        }

        return map;
    }
}
