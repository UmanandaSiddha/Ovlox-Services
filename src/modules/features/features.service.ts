import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { FeatureStatus } from 'generated/prisma/enums';
import { CreateFeatureDto } from './dto/create-feature.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';

@Injectable()
export class FeaturesService {
    constructor(private readonly databaseService: DatabaseService) { }

    /**
     * Get organization ID from project ID
     */
    private async getProjectOrg(projectId: string) {
        const project = await this.databaseService.project.findUnique({
            where: { id: projectId },
            select: { organizationId: true },
        });
        if (!project) {
            throw new NotFoundException(`Project ${projectId} not found`);
        }
        return project.organizationId;
    }

    /**
     * Create feature
     */
    async createFeature(projectId: string, data: CreateFeatureDto, createdById: string) {
        const organizationId = await this.getProjectOrg(projectId);

        // Check if feature with same name already exists
        const existing = await this.databaseService.feature.findUnique({
            where: {
                projectId_name: {
                    projectId,
                    name: data.name,
                },
            },
        });

        if (existing) {
            throw new BadRequestException(`Feature with name "${data.name}" already exists in this project`);
        }

        const feature = await this.databaseService.feature.create({
            data: {
                projectId,
                name: data.name,
                description: data.description || undefined,
                status: FeatureStatus.DISCOVERED,
                autoDetected: false,
                detectedById: createdById,
            },
            include: {
                events: {
                    include: { rawEvent: true },
                },
            },
        });

        return feature;
    }

    /**
     * Update feature
     */
    async updateFeature(featureId: string, data: UpdateFeatureDto, userId: string) {
        const feature = await this.databaseService.feature.findUnique({
            where: { id: featureId },
            select: { id: true, projectId: true, status: true },
        });

        if (!feature) {
            throw new NotFoundException(`Feature ${featureId} not found`);
        }

        // Check name uniqueness if name is being updated
        if (data.name && data.name !== feature.id) {
            const existing = await this.databaseService.feature.findUnique({
                where: {
                    projectId_name: {
                        projectId: feature.projectId,
                        name: data.name,
                    },
                },
            });

            if (existing && existing.id !== featureId) {
                throw new BadRequestException(`Feature with name "${data.name}" already exists in this project`);
            }
        }

        const completionDate = data.status === FeatureStatus.COMPLETED && feature.status !== FeatureStatus.COMPLETED
            ? new Date()
            : feature.status === FeatureStatus.COMPLETED && data.status && data.status !== FeatureStatus.COMPLETED
            ? null
            : undefined;

        // Get user's organization member ID for completion tracking
        let completedByMemberId: string | null = null;
        if (data.status === FeatureStatus.COMPLETED) {
            const organizationId = await this.getProjectOrg(feature.projectId);
            const member = await this.databaseService.organizationMember.findFirst({
                where: { userId, organizationId },
            });
            completedByMemberId = member?.id || null;
        }

        const updated = await this.databaseService.feature.update({
            where: { id: featureId },
            data: {
                name: data.name,
                description: data.description,
                status: data.status,
                completionDate,
                completedByMemberId: completedByMemberId || undefined,
            },
            include: {
                events: {
                    include: { rawEvent: true },
                    orderBy: { createdAt: 'desc' },
                },
            },
        });

        return updated;
    }

    /**
     * Delete feature
     */
    async deleteFeature(featureId: string, userId: string) {
        const feature = await this.databaseService.feature.findUnique({
            where: { id: featureId },
        });

        if (!feature) {
            throw new NotFoundException(`Feature ${featureId} not found`);
        }

        await this.databaseService.feature.delete({
            where: { id: featureId },
        });

        return { message: 'Feature deleted successfully' };
    }

    /**
     * Update feature status
     */
    async updateFeatureStatus(featureId: string, status: FeatureStatus, userId: string) {
        const feature = await this.databaseService.feature.findUnique({
            where: { id: featureId },
        });

        if (!feature) {
            throw new NotFoundException(`Feature ${featureId} not found`);
        }

        const completionDate = status === FeatureStatus.COMPLETED ? new Date() : null;

        // Get user's organization member ID
        const organizationId = await this.getProjectOrg(feature.projectId);
        const member = await this.databaseService.organizationMember.findFirst({
            where: { userId, organizationId },
        });

        const updated = await this.databaseService.feature.update({
            where: { id: featureId },
            data: {
                status,
                completionDate,
                completedByMemberId: status === FeatureStatus.COMPLETED && member ? member.id : undefined,
            },
            include: {
                events: {
                    include: { rawEvent: true },
                    orderBy: { createdAt: 'desc' },
                },
            },
        });

        return updated;
    }

    /**
     * Link RawEvent to feature
     */
    async linkRawEventToFeature(featureId: string, rawEventId: string, relevance: number = 1.0) {
        const feature = await this.databaseService.feature.findUnique({
            where: { id: featureId },
        });

        if (!feature) {
            throw new NotFoundException(`Feature ${featureId} not found`);
        }

        const rawEvent = await this.databaseService.rawEvent.findUnique({
            where: { id: rawEventId },
        });

        if (!rawEvent) {
            throw new NotFoundException(`RawEvent ${rawEventId} not found`);
        }

        const link = await this.databaseService.featureEvent.upsert({
            where: {
                featureId_rawEventId: {
                    featureId,
                    rawEventId,
                },
            },
            update: {
                relevance,
            },
            create: {
                featureId,
                rawEventId,
                relevance,
            },
            include: {
                rawEvent: true,
            },
        });

        // Update autoDetectedByMemberId if this is the first event and it has an author
        if (!feature.autoDetectedByMemberId && rawEvent.authorMemberId) {
            await this.databaseService.feature.update({
                where: { id: featureId },
                data: {
                    autoDetectedByMemberId: rawEvent.authorMemberId,
                },
            });
        }

        return link;
    }

    /**
     * Get features with filters
     */
    async getFeatures(
        projectId: string,
        filters: {
            status?: FeatureStatus;
            limit?: number;
            offset?: number;
        },
    ) {
        const features = await this.databaseService.feature.findMany({
            where: {
                projectId,
                ...(filters.status ? { status: filters.status } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: filters.limit || 50,
            skip: filters.offset || 0,
            include: {
                events: {
                    include: { rawEvent: true },
                    take: 5,
                    orderBy: { createdAt: 'desc' },
                },
            },
        });

        return features;
    }

    /**
     * Get feature details
     */
    async getFeature(featureId: string) {
        const feature = await this.databaseService.feature.findUnique({
            where: { id: featureId },
            include: {
                events: {
                    include: { rawEvent: true },
                    orderBy: { createdAt: 'desc' },
                },
            },
        });

        if (!feature) {
            throw new NotFoundException(`Feature ${featureId} not found`);
        }

        return feature;
    }
}
