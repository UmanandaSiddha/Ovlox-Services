import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CreditAnalyticsService } from './credit-analytics.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorator/permission.decorator';
import { PermissionName } from 'generated/prisma/enums';

@Controller('orgs/:orgId/analytics/credits')
@UseGuards(AuthGuard, PermissionGuard)
export class CreditAnalyticsController {
    constructor(private readonly creditAnalyticsService: CreditAnalyticsService) { }

    @Get('expenditure')
    @RequirePermission(PermissionName.VIEW_REPORTS)
    async getOrgCreditExpenditure(
        @Param('orgId') orgId: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('projectId') projectId?: string,
    ) {
        return this.creditAnalyticsService.getOrgCreditExpenditure(orgId, {
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
            projectId,
        });
    }

    @Get('projects/:projectId')
    @RequirePermission(PermissionName.VIEW_REPORTS)
    async getProjectCreditExpenditure(
        @Param('orgId') orgId: string,
        @Param('projectId') projectId: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('limit') limit?: string,
    ) {
        return this.creditAnalyticsService.getProjectCreditExpenditure(orgId, projectId, {
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
            limit: limit ? parseInt(limit) : 50,
        });
    }
}
