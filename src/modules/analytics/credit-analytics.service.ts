import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { LlmOperationType } from 'generated/prisma/enums';

export interface CreditExpenditureSummary {
    totalCredits: number;
    byOperationType: Record<LlmOperationType, number>;
    byProject: Array<{
        projectId: string;
        projectName: string;
        totalCredits: number;
        breakdown: Record<LlmOperationType, number>;
    }>;
    periodStart?: Date;
    periodEnd?: Date;
}

export interface ProjectCreditExpenditure {
    projectId: string;
    projectName: string;
    totalCredits: number;
    byOperationType: Array<{
        operationType: LlmOperationType;
        count: number;
        totalCredits: number;
        avgCreditsPerOperation: number;
    }>;
    recentTransactions: Array<{
        id: string;
        operationType: LlmOperationType;
        credits: number;
        createdAt: Date;
        description?: string;
    }>;
}

@Injectable()
export class CreditAnalyticsService {
    constructor(private readonly databaseService: DatabaseService) { }

    /**
     * Get organization credit expenditure summary
     */
    async getOrgCreditExpenditure(
        orgId: string,
        options: {
            startDate?: Date;
            endDate?: Date;
            projectId?: string;
        } = {},
    ): Promise<CreditExpenditureSummary> {
        const { startDate, endDate, projectId } = options;

        // Get all credit transactions for this org
        const where: any = {
            organizationId: orgId,
            type: 'USAGE', // Only usage transactions
            amount: { lt: 0 }, // Negative amounts (credits spent)
        };

        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt.gte = startDate;
            if (endDate) where.createdAt.lte = endDate;
        }

        if (projectId) {
            where.llmUsage = {
                referenceType: 'project',
                referenceId: projectId,
            };
        }

        const transactions = await this.databaseService.creditTransaction.findMany({
            where,
            include: {
                llmUsage: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        // Calculate totals
        const totalCredits = Math.abs(
            transactions.reduce((sum, txn) => sum + Number(txn.amount), 0),
        );

        // Group by operation type
        const byOperationType: Record<string, number> = {};
        transactions.forEach((txn) => {
            if (txn.llmUsage) {
                const opType = txn.llmUsage.operationType;
                byOperationType[opType] = (byOperationType[opType] || 0) + Math.abs(Number(txn.amount));
            }
        });

        // Group by project
        const projectMap = new Map<string, {
            projectId: string;
            projectName: string;
            totalCredits: number;
            breakdown: Record<string, number>;
        }>();

        // Get all unique project IDs from llmUsage references
        const projectIds = new Set<string>();
        transactions.forEach((txn) => {
            if (txn.llmUsage?.referenceType === 'project' && txn.llmUsage.referenceId) {
                projectIds.add(txn.llmUsage.referenceId);
            }
        });

        // Fetch project details
        const projects = projectIds.size > 0 ? await this.databaseService.project.findMany({
            where: {
                id: { in: Array.from(projectIds) },
            },
            select: {
                id: true,
                name: true,
            },
        }) : [];

        const projectNameMap = new Map(projects.map(p => [p.id, p.name]));

        transactions.forEach((txn) => {
            if (txn.llmUsage?.referenceType === 'project' && txn.llmUsage.referenceId) {
                const projId = txn.llmUsage.referenceId;
                const projName = projectNameMap.get(projId) || 'Unknown Project';

                if (!projectMap.has(projId)) {
                    projectMap.set(projId, {
                        projectId: projId,
                        projectName: projName,
                        totalCredits: 0,
                        breakdown: {},
                    });
                }

                const project = projectMap.get(projId)!;
                const credits = Math.abs(Number(txn.amount));
                project.totalCredits += credits;

                const opType = txn.llmUsage.operationType;
                project.breakdown[opType] = (project.breakdown[opType] || 0) + credits;
            }
        });

        return {
            totalCredits,
            byOperationType: byOperationType as Record<LlmOperationType, number>,
            byProject: Array.from(projectMap.values()),
            periodStart: startDate,
            periodEnd: endDate,
        };
    }

    /**
     * Get detailed project credit expenditure
     */
    async getProjectCreditExpenditure(
        orgId: string,
        projectId: string,
        options: {
            startDate?: Date;
            endDate?: Date;
            limit?: number;
        } = {},
    ): Promise<ProjectCreditExpenditure> {
        const { startDate, endDate, limit = 50 } = options;

        // Verify project belongs to org
        const project = await this.databaseService.project.findUnique({
            where: { id: projectId },
            select: { id: true, name: true, organizationId: true },
        });

        if (!project || project.organizationId !== orgId) {
            throw new NotFoundException(`Project ${projectId} not found in organization`);
        }

        // Get all credit transactions for this project
        const where: any = {
            organizationId: orgId,
            type: 'USAGE',
            amount: { lt: 0 },
            llmUsage: {
                referenceType: 'project',
                referenceId: projectId,
            },
        };

        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt.gte = startDate;
            if (endDate) where.createdAt.lte = endDate;
        }

        const transactions = await this.databaseService.creditTransaction.findMany({
            where,
            include: {
                llmUsage: true,
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        // Calculate totals
        const totalCredits = Math.abs(
            transactions.reduce((sum, txn) => sum + Number(txn.amount), 0),
        );

        // Group by operation type
        const operationMap = new Map<LlmOperationType, {
            count: number;
            totalCredits: number;
        }>();

        transactions.forEach((txn) => {
            if (txn.llmUsage) {
                const opType = txn.llmUsage.operationType;
                if (!operationMap.has(opType)) {
                    operationMap.set(opType, {
                        count: 0,
                        totalCredits: 0,
                    });
                }

                const op = operationMap.get(opType)!;
                op.count++;
                op.totalCredits += Math.abs(Number(txn.amount));
            }
        });

        // Format by operation type
        const byOperationType = Array.from(operationMap.entries()).map(([opType, data]) => ({
            operationType: opType,
            count: data.count,
            totalCredits: data.totalCredits,
            avgCreditsPerOperation: data.totalCredits / data.count,
        }));

        // Recent transactions
        const recentTransactions = transactions.slice(0, 20).map((txn) => ({
            id: txn.id,
            operationType: txn.llmUsage?.operationType || 'EMBEDDING' as LlmOperationType,
            credits: Math.abs(Number(txn.amount)),
            createdAt: txn.createdAt,
            description: txn.llmUsage?.status || undefined,
        }));

        return {
            projectId: project.id,
            projectName: project.name,
            totalCredits,
            byOperationType,
            recentTransactions,
        };
    }
}
