import { Controller, Post, Get, Put, Body, Param, Query, UseGuards, BadRequestException, HttpCode, HttpStatus, Sse, Header } from '@nestjs/common';
import { LlmService } from './llm.service';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorator/permission.decorator';
import { PermissionName, ReportType, JobStatus, ChatRole } from 'generated/prisma/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { ConversationType } from 'generated/prisma/enums';
import { ChatGateway } from '../chat/chat.gateway';
import { LLMQueue } from 'src/services/queue/llm.queue';
import { interval, Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';

@UseGuards(AuthGuard)
@Controller('chat')
export class LlmController {
    constructor(
        private readonly llmService: LlmService,
        private readonly databaseService: DatabaseService,
        private readonly chatGateway: ChatGateway,
        private readonly llmQueue: LLMQueue,
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
    @HttpCode(HttpStatus.ACCEPTED)
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

        // Create user message immediately
        const userMessage = await this.databaseService.chatMessage.create({
            data: {
                conversationId,
                role: ChatRole.USER,
                content: question.trim(),
                senderId: userId,
                senderMemberId: memberId || undefined,
            },
            include: {
                sender: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
                senderMember: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                avatarUrl: true,
                            },
                        },
                    },
                },
            },
        });

        // Emit user message immediately via WebSocket
        await this.chatGateway.emitToConversation(conversationId, 'newMessage', {
            message: userMessage,
            conversationId,
        });

        // Create Job record for tracking
        const job = await this.databaseService.job.create({
            data: {
                type: 'llm_chat',
                payload: {
                    conversationId,
                    question,
                    userId,
                    projectId: conversation.projectId || undefined,
                    organizationId: conversation.project?.organizationId || conversation.organizationId || undefined,
                    userMessageId: userMessage.id,
                },
                status: JobStatus.PENDING,
            },
        });

        // Queue LLM processing
        await this.llmQueue.enqueue({
            mode: 'chat',
            conversationId,
            question,
            userId,
            projectId: conversation.projectId || undefined,
            organizationId: conversation.project?.organizationId || conversation.organizationId || undefined,
            jobId: job.id, // Link BullMQ job to DB job
            userMessageId: userMessage.id,
        });

        // Emit processing status
        await this.chatGateway.emitToConversation(conversationId, 'messageProcessing', {
            conversationId,
            userMessageId: userMessage.id,
            jobId: job.id,
            status: 'processing',
        });

        // Return immediately with job info
        return {
            status: 'processing',
            jobId: job.id,
            userMessage,
            message: 'Your message is being processed...',
        };
    }

    @Get('jobs/:jobId/status')
    async getJobStatus(@Param('jobId') jobId: string, @getUser('id') userId: string) {
        const job = await this.databaseService.job.findUnique({
            where: { id: jobId },
        });

        if (!job) {
            throw new BadRequestException('Job not found');
        }

        // Verify user has access (check if job is related to user's conversations/projects)
        const payload = job.payload as any;
        if (payload.userId && payload.userId !== userId) {
            throw new BadRequestException('Access denied');
        }

        return job;
    }

    @Post('jobs/:jobId/retry')
    async retryJob(@Param('jobId') jobId: string, @getUser('id') userId: string) {
        const job = await this.databaseService.job.findUnique({
            where: { id: jobId },
        });

        if (!job) {
            throw new BadRequestException('Job not found');
        }

        if (job.status !== JobStatus.FAILED && job.status !== JobStatus.RETRY) {
            throw new BadRequestException('Job cannot be retried');
        }

        const payload = job.payload as any;
        if (payload.userId && payload.userId !== userId) {
            throw new BadRequestException('Access denied');
        }

        // Reset job status
        await this.databaseService.job.update({
            where: { id: jobId },
            data: {
                status: JobStatus.PENDING,
                attempts: 0,
            },
        });

        // Re-queue the job
        await this.llmQueue.enqueue({
            mode: payload.mode || 'chat',
            ...payload,
            jobId,
        });

        return {
            status: 'queued',
            jobId,
            message: 'Job has been queued for retry',
        };
    }

    @Sse('jobs/:jobId/stream')
    @Header('Cache-Control', 'no-cache')
    @Header('Content-Type', 'text/event-stream')
    @Header('Connection', 'keep-alive')
    streamJobStatus(@Param('jobId') jobId: string, @getUser('id') userId: string): Observable<MessageEvent> {
        return interval(1000).pipe(
            switchMap(async () => {
                const job = await this.databaseService.job.findUnique({
                    where: { id: jobId },
                });

                if (!job) {
                    return { data: JSON.stringify({ error: 'Job not found' }) } as MessageEvent;
                }

                // Verify access
                const payload = job.payload as any;
                if (payload.userId && payload.userId !== userId) {
                    return { data: JSON.stringify({ error: 'Access denied' }) } as MessageEvent;
                }

                // Stop streaming if job is completed or failed
                if (job.status === 'COMPLETED' || job.status === 'FAILED') {
                    return {
                        data: JSON.stringify({
                            jobId: job.id,
                            status: job.status,
                            attempts: job.attempts,
                            payload: job.payload,
                            updatedAt: job.updatedAt,
                            completed: true,
                        }),
                    } as MessageEvent;
                }

                return {
                    data: JSON.stringify({
                        jobId: job.id,
                        status: job.status,
                        attempts: job.attempts,
                        payload: job.payload,
                        updatedAt: job.updatedAt,
                    }),
                } as MessageEvent;
            }),
        );
    }
}

@Controller('orgs/:orgId/projects/:projectId/reports')
@UseGuards(AuthGuard, PermissionGuard)
export class ReportsController {
    constructor(
        private readonly llmService: LlmService,
        private readonly databaseService: DatabaseService,
        private readonly llmQueue: LLMQueue,
    ) { }

    @Post('generate')
    @RequirePermission(PermissionName.VIEW_REPORTS)
    @HttpCode(HttpStatus.ACCEPTED)
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

        // Create Job record for tracking
        const job = await this.databaseService.job.create({
            data: {
                type: 'llm_project_report',
                payload: {
                    projectId,
                    periodStart: periodStart.toISOString(),
                    periodEnd: periodEnd.toISOString(),
                    reportType,
                    generatedById: userId,
                },
                status: JobStatus.PENDING,
            },
        });

        // Queue report generation
        await this.llmQueue.enqueue({
            mode: 'project_report',
            projectId,
            jobId: job.id,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            reportType,
            generatedById: userId,
        });

        // Return immediately with job info
        return {
            status: 'processing',
            jobId: job.id,
            message: 'Report generation has been queued. Use SSE endpoint or job status endpoint to track progress.',
        };
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
