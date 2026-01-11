import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { PrismaApiFeatures, QueryString } from 'src/utils/apiFeatures';
import { Prisma } from 'generated/prisma/client';

@Injectable()
export class ProjectsService {
    constructor(
        private readonly databaseService: DatabaseService,
    ) { }

    async create(projectDto: { organizationId: string; name: string; createdBy: string; description?: string }) {
        const slug = projectDto.name.toLowerCase().replace(/[^\w]+/g, '-').slice(0, 50);
        return this.databaseService.project.create({
            data: {
                organization: {
                    connect: { id: projectDto.organizationId }
                },
                name: projectDto.name,
                slug,
                description: projectDto.description,
                createdBy: {
                    connect: { id: projectDto.createdBy }
                },
            },
        });
    }

    async update(projectId: string, orgId: string, data: { name?: string; description?: string }) {
        const project = await this.databaseService.project.findFirst({
            where: { id: projectId, organizationId: orgId }
        });
        if (!project) throw new NotFoundException('Project not found');

        const updateData: any = {};
        if (data.name) {
            updateData.name = data.name;
            updateData.slug = data.name.toLowerCase().replace(/[^\w]+/g, '-').slice(0, 50);
        }
        if (data.description !== undefined) updateData.description = data.description;

        return this.databaseService.project.update({
            where: { id: projectId },
            data: updateData,
        });
    }

    async delete(projectId: string, orgId: string) {
        const project = await this.databaseService.project.findFirst({
            where: { id: projectId, organizationId: orgId }
        });
        if (!project) throw new NotFoundException('Project not found');

        await this.databaseService.project.delete({
            where: { id: projectId }
        });
        return { message: 'Project deleted successfully' };
    }

    async list(projectId: string) {
        return this.databaseService.project.findUnique({ 
            where: { id: projectId }, 
            include: { 
                integrations: {
                    include: {
                        integration: true
                    }
                },
                organization: true,
                createdBy: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true
                    }
                }
            } 
        });
    }

    async listByOrg(orgId: string, filters: QueryString) {
        const apiFeatures = new PrismaApiFeatures<
            Prisma.ProjectWhereInput,
            Prisma.ProjectInclude,
            Prisma.ProjectOrderByWithRelationInput,
            typeof this.databaseService.project
        >(this.databaseService.project, filters)
            .where({ organizationId: orgId })
            .search(['name', 'description'])
            .filter()
            .sort()
            .include({
                integrations: {
                    include: {
                        integration: true
                    }
                },
                createdBy: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true
                    }
                }
            })
            .pagination();

        const { results: projects, totalCount } = await apiFeatures.execute();

        return {
            success: true,
            count: projects.length,
            totalCount,
            totalPages: Math.ceil(totalCount / (Number(filters.limit) || 10)),
            data: projects,
        };
    }

    async linkIntegration(projectId: string, integrationId: string, items: any) {
        // Verify project exists
        const project = await this.databaseService.project.findUnique({
            where: { id: projectId }
        });
        if (!project) throw new NotFoundException('Project not found');

        // Verify integration exists and belongs to same org
        const integration = await this.databaseService.integration.findUnique({
            where: { id: integrationId }
        });
        if (!integration) throw new NotFoundException('Integration not found');
        if (integration.organizationId !== project.organizationId) {
            throw new BadRequestException('Integration does not belong to the same organization');
        }

        return this.databaseService.integrationConnection.create({
            data: {
                projectId,
                integrationId,
                items,
            },
        });
    }

    async getAvailableResources(projectId: string) {
        const project = await this.databaseService.project.findUnique({
            where: { id: projectId },
            include: {
                organization: {
                    include: {
                        integrations: {
                            include: {
                                resources: true
                            }
                        }
                    }
                }
            }
        });

        if (!project) throw new NotFoundException('Project not found');

        // Get all resources from integrations in the same organization
        const resources = await this.databaseService.integrationResource.findMany({
            where: {
                integration: {
                    organizationId: project.organizationId
                }
            },
            include: {
                integration: {
                    select: {
                        id: true,
                        type: true,
                        status: true
                    }
                }
            }
        });

        return resources;
    }
}