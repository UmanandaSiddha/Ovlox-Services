import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';

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

    async linkIntegration(projectId: string, integrationId: string, items: any) {
        return this.databaseService.integrationConnection.create({
            data: {
                projectId,
                integrationId,
                items,
            },
        });
    }

    async list(projectId: string) {
        return this.databaseService.project.findUnique({ where: { id: projectId }, include: { integrations: true } });
    }
}