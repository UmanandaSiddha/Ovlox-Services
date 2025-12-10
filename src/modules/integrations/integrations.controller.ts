import { Controller, Post, Body, UseGuards, Req, Get, Param } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ExternalProvider, IntegrationAuthType } from 'generated/prisma/enums';

@UseGuards(AuthGuard)
@Controller('integrations')
export class IntegrationsController {
    constructor(private integrations: IntegrationsService) { }

    @Post('connect')
    async connect(@Req() req: any, @Body() body: { orgId: string; type: ExternalProvider; authType: IntegrationAuthType; config: any }) {
        return this.integrations.create(body.orgId, body.type, body.authType, body.config);
    }

    @Get('org/:orgId')
    async list(@Param('orgId') orgId: string) {
        return this.integrations.listForOrg(orgId);
    }
}