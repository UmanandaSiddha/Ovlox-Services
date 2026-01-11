import { Controller, Post, Get, Put, Body, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { LlmService } from './llm.service';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorator/permission.decorator';
import { PermissionName, ReportType } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { ConversationType } from 'generated/prisma/enums';

@UseGuards(AuthGuard)
@Controller('chat')
export class LlmController {
    constructor(
        private readonly llmService: LlmService,
        private readonly databaseService: DatabaseService,
    ) { }

    @Post('conversations')
    async createConversation(
        @getUser('id') userId: string,
        @Body() body: { projectId?: string; organizationId?: string; title?: string; type?: ConversationType }
    ) {
        const { projectId, organizationId, title, type = 'RAG_CHAT' } = body;

        if (!projectId && !organizationId) {
            throw new BadRequestException('Either projectId or organizationId is required');
        }

        if (type === 'RAG_CHAT' && !projectId) {
            throw new BadRequestException('RAG_CHAT requires a projectId');
        }

        const conversation = await this.databaseService.conversation.create({
            data: {
                type,
                projectId: projectId || undefined,
                organizationId: organizationId || undefined,
                title: title || 'New Conversation',
                createdBy: userId,
            },
        });

        // Add user as participant
        await this.databaseService.conversationParticipant.create({
            data: {
                conversationId: conversation.id,
                userId,
            },
        });

        return conversation;
    }

    @Get('conversations')
    async listConversations(
        @getUser('id') userId: string,
        @Query('projectId') projectId?: string,
        @Query('organizationId') organizationId?: string
    ) {
        const conversations = await this.databaseService.conversationParticipant.findMany({
            where: {
                userId,
                leftAt: null,
                ...(projectId ? { conversation: { projectId } } : {}),
                ...(organizationId ? { conversation: { organizationId } } : {}),
            },
            include: {
                conversation: {
                    include: {
                        messages: {
                            take: 1,
                            orderBy: { createdAt: 'desc' },
                        },
                    },
                },
            },
            orderBy: {
                conversation: {
                    updatedAt: 'desc',
                },
            },
            take: 50,
        });

        return conversations.map((cp) => cp.conversation);
    }

    @Get('conversations/:id')
    async getConversation(@Param('id') id: string, @getUser('id') userId: string) {
        const participant = await this.databaseService.conversationParticipant.findUnique({
            where: {
                conversationId_userId: {
                    conversationId: id,
                    userId,
                },
            },
            include: {
                conversation: {
                    include: {
                        messages: {
                            orderBy: { createdAt: 'asc' },
                            take: 100,
                        },
                        project: {
                            include: { organization: true },
                        },
                        organization: true,
                    },
                },
            },
        });

        if (!participant || participant.leftAt) {
            throw new BadRequestException('Conversation not found or access denied');
        }

        return participant.conversation;
    }

    @Put('conversations/:id')
    async updateConversation(
        @Param('id') id: string,
        @getUser('id') userId: string,
        @Body() body: { title?: string }
    ) {
        // Verify user is participant
        const participant = await this.databaseService.conversationParticipant.findUnique({
            where: {
                conversationId_userId: {
                    conversationId: id,
                    userId,
                },
            },
        });

        if (!participant || participant.leftAt) {
            throw new BadRequestException('Conversation not found or access denied');
        }

        return this.databaseService.conversation.update({
            where: { id },
            data: { title: body.title },
        });
    }

    @Get('conversations/:id/messages')
    async getMessages(
        @Param('id') conversationId: string,
        @getUser('id') userId: string,
        @Query('limit') limit: number = 50,
        @Query('before') before?: string
    ) {
        // Verify user is participant
        const participant = await this.databaseService.conversationParticipant.findUnique({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId,
                },
            },
        });

        if (!participant || participant.leftAt) {
            throw new BadRequestException('Conversation not found or access denied');
        }

        const messages = await this.databaseService.chatMessage.findMany({
            where: {
                conversationId,
                ...(before ? { id: { lt: before } } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: Math.min(limit, 100),
            include: {
                sender: true,
                senderMember: true,
                sources: {
                    include: {
                        rawEvent: true,
                        llmOutput: true,
                    },
                },
            },
        });

        return messages.reverse(); // Return in chronological order
    }

    @Post('conversations/:id/messages')
    async sendMessage(
        @Param('id') conversationId: string,
        @getUser('id') userId: string,
        @Body() body: { question: string }
    ) {
        const { question } = body;

        if (!question || question.trim().length === 0) {
            throw new BadRequestException('Question is required');
        }

        // Get conversation with project/org context
        const conversation = await this.databaseService.conversation.findUnique({
            where: { id: conversationId },
            include: {
                project: {
                    include: { organization: true },
                },
                organization: true,
            },
        });

        if (!conversation) {
            throw new BadRequestException('Conversation not found');
        }

        // Verify user is participant
        const participant = await this.databaseService.conversationParticipant.findUnique({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId,
                },
            },
        });

        if (!participant || participant.leftAt) {
            throw new BadRequestException('Access denied');
        }

        // Get user's organization member if project/org exists
        let memberId: string | undefined;
        if (conversation.project) {
            const member = await this.databaseService.organizationMember.findFirst({
                where: {
                    userId,
                    organizationId: conversation.project.organizationId,
                },
            });
            memberId = member?.id;
        } else if (conversation.organizationId) {
            const member = await this.databaseService.organizationMember.findFirst({
                where: {
                    userId,
                    organizationId: conversation.organizationId,
                },
            });
            memberId = member?.id;
        }

        // Use LlmService.chat method
        const result = await this.llmService.chat({
            conversationId,
            question,
            userId,
            projectId: conversation.projectId || undefined,
            organizationId: conversation.project?.organizationId || conversation.organizationId || undefined,
        });

        return result;
    }
}

@Controller('orgs/:orgId/projects/:projectId/reports')
@UseGuards(AuthGuard, PermissionGuard)
export class ReportsController {
    constructor(
        private readonly llmService: LlmService,
        private readonly databaseService: DatabaseService,
    ) { }

    @Post('generate')
    @RequirePermission(PermissionName.VIEW_REPORTS)
    async generateReport(
        @Param('orgId') orgId: string,
        @Param('projectId') projectId: string,
        @Body() body: { type: ReportType; startDate?: string; endDate?: string },
        @getUser('id') userId: string,
    ) {
        const { type, startDate, endDate } = body;

        // Default dates if not provided (last 7 days)
        const periodEnd = endDate ? new Date(endDate) : new Date();
        const periodStart = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        // Map ReportType enum - convert string to proper type
        let reportType: 'DAILY' | 'WEEKLY' | 'MONTHLY' = 'DAILY';
        if (type === 'DAILY' || type === 'WEEKLY' || type === 'MONTHLY') {
            reportType = type;
        }

        // Generate report using LlmService
        const reportResult = await this.llmService.generateProjectReport({
            projectId,
            periodStart,
            periodEnd,
            reportType,
            generatedById: userId,
        });

        // Report is already created by LlmService, just fetch it
        const report = await this.databaseService.projectReport.findUnique({
            where: { id: reportResult.reportId },
            include: {
                generatedBy: true,
            },
        });

        return report || reportResult;
    }

    @Get()
    @RequirePermission(PermissionName.VIEW_REPORTS)
    async getReports(
        @Param('projectId') projectId: string,
        @Query('type') type?: ReportType,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        const reports = await this.databaseService.projectReport.findMany({
            where: {
                projectId,
                ...(type ? { reportType: type } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: limit ? parseInt(limit) : 50,
            skip: offset ? parseInt(offset) : 0,
            include: {
                generatedBy: true,
            },
        });

        return reports;
    }

    @Get(':id')
    @RequirePermission(PermissionName.VIEW_REPORTS)
    async getReport(@Param('id') id: string) {
        const report = await this.databaseService.projectReport.findUnique({
            where: { id },
            include: {
                generatedBy: true,
            },
        });

        if (!report) {
            throw new BadRequestException('Report not found');
        }

        return report;
    }
}
