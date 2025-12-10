import { Injectable } from '@nestjs/common';
import { ExternalProvider, IntegrationAuthType } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';

@Injectable()
export class IntegrationsService {
    constructor(
        private readonly databaseService: DatabaseService,
    ) { }

    async create(orgId: string, type: ExternalProvider, authType: IntegrationAuthType, config: any) {
        return this.databaseService.integration.create({
            data: { organization: { connect: { id: orgId } }, type, authType, config },
        });
    }

    async listForOrg(orgId: string) {
        return this.databaseService.integration.findMany({ where: { organizationId: orgId } });
    }

    async updateConfig(id: string, config: any) {
        return this.databaseService.integration.update({ where: { id }, data: { config } });
    }

    async addResource(integrationId: string, provider: string, providerId: string, name: string, url?: string, meta?: any) {
        return this.databaseService.integrationResource.create({
            data: {
                integrationId,
                provider: provider as any,
                providerId,
                name,
                url,
                metadata: meta,
            },
        });
    }
}