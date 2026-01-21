import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { LLM_QUEUE } from 'src/config/constants';
import { LLMJobPayload } from '../llm.queue';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { LoggerService } from 'src/services/logger/logger.service';
import { LlmService } from 'src/modules/llm/llm.service';
import { ChatGateway } from 'src/modules/chat/chat.gateway';
import { JobStatus } from 'generated/prisma/enums';

@Injectable()
@Processor(LLM_QUEUE)
export class LLMProcessor extends WorkerHost {
    private readonly logger = new LoggerService(LLMProcessor.name);

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly llmService: LlmService,
        private readonly chatGateway: ChatGateway,
    ) {
        super();
    }

    async process(job) {
        const data = job.data as LLMJobPayload;
        const jobId = data.jobId;

        this.logger.log(`Processing LLM task mode=${data.mode} jobId=${jobId}`, LLMProcessor.name);

            // Update job status to RUNNING (do not increment attempts here)
            if (jobId) {
                await this.updateJobStatus(jobId, JobStatus.RUNNING, { incrementAttempt: false });
            }

        try {
            let result: any;

            if (data.mode === 'summary') {
                result = await this.processSummary(data.rawEventId, jobId);
            } else if (data.mode === 'chat') {
                if (!data.conversationId || !data.question || !data.userId) {
                    throw new Error('Chat mode requires conversationId, question, and userId');
                }
                result = await this.processChat(
                    data.conversationId,
                    data.question,
                    data.projectId,
                    data.userId,
                    data.jobId,
                    data.userMessageId
                );
            } else if (data.mode === 'project_report') {
                result = await this.processProjectReport(
                    data.projectId!,
                    data.jobId,
                    data.periodStart,
                    data.periodEnd,
                    data.reportType,
                    data.generatedById
                );
            } else {
                this.logger.warn(`Unknown LLM mode: ${data.mode}`, LLMProcessor.name);
                return true;
            }

            // Update job status to COMPLETED
            if (jobId) {
                await this.updateJobStatus(jobId, JobStatus.COMPLETED, result, undefined, { incrementAttempt: false });
            }

            return result;
        } catch (error) {
            this.logger.error(`LLM job processing failed: ${job.id} - ${error.message}`, LLMProcessor.name);
            
            // Update job status to FAILED (increment attempts for failures)
            if (jobId) {
                await this.updateJobStatus(jobId, JobStatus.FAILED, null, error.message, { incrementAttempt: true });
            }

            throw error;
        }
    }

    private async updateJobStatus(
        jobId: string,
        status: JobStatus,
        result?: any,
        error?: string,
        options?: { incrementAttempt?: boolean }
    ) {
        try {
            const currentJob = await this.databaseService.job.findUnique({
                where: { id: jobId },
            });

            if (!currentJob) {
                this.logger.warn(`Job ${jobId} not found for status update`, LLMProcessor.name);
                return;
            }

            const currentPayload = (currentJob.payload as any) || {};

            await this.databaseService.job.update({
                where: { id: jobId },
                data: {
                    status,
                    ...(options?.incrementAttempt ? { attempts: { increment: 1 } } : {}),
                    payload: {
                        ...currentPayload,
                        ...(result ? { result } : {}),
                        ...(error ? { error, failedAt: new Date().toISOString() } : {}),
                        lastStatusUpdate: new Date().toISOString(),
                    },
                },
            });
        } catch (err) {
            this.logger.error(`Failed to update job status: ${err.message}`, LLMProcessor.name);
        }
    }

    private async processSummary(rawEventId: string, jobId?: string) {
        // Use LlmService to process the RawEvent
        const llmOutput = await this.llmService.processRawEvent(rawEventId);
        
        // Emit event if needed (for future SSE/WebSocket support)
        if (jobId) {
            // Could emit progress updates here
        }
        
        return llmOutput;
    }

    private async processChat(
        conversationId: string,
        question: string,
        projectId: string | undefined,
        userId: string,
        jobId?: string,
        userMessageId?: string
    ) {
        // Get conversation to determine project/org
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
            throw new Error(`Conversation ${conversationId} not found`);
        }

        const actualProjectId = conversation.projectId || projectId;
        const organizationId = conversation.project?.organizationId || conversation.organizationId;

        if (!organizationId) {
            throw new Error('Conversation must be associated with a project or organization');
        }

        // Emit processing status
        if (jobId) {
            await this.chatGateway.emitToConversation(conversationId, 'messageProcessing', {
                conversationId,
                userMessageId,
                jobId,
                status: 'processing',
                stage: 'generating_answer',
            });
        }

        // Use LlmService chat method
        const result = await this.llmService.chat({
            conversationId,
            question,
            userId,
            projectId: actualProjectId,
            organizationId,
            userMessageId,
        });

        // Fetch the assistant message with full relations
        if (result.chatMessageId) {
            const assistantMessage = await this.databaseService.chatMessage.findUnique({
                where: { id: result.chatMessageId },
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
                    mentions: {
                        include: {
                            mentionedUser: {
                                select: {
                                    id: true,
                                    firstName: true,
                                    lastName: true,
                                },
                            },
                        },
                    },
                    sources: {
                        include: {
                            rawEvent: true,
                            llmOutput: true,
                        },
                    },
                },
            });

            // Emit assistant message via WebSocket
            if (assistantMessage) {
                await this.chatGateway.emitToConversation(conversationId, 'newMessage', {
                    message: assistantMessage,
                    conversationId,
                    jobId,
                });

                // Emit completion status
                await this.chatGateway.emitToConversation(conversationId, 'messageProcessing', {
                    conversationId,
                    userMessageId,
                    jobId,
                    status: 'completed',
                    assistantMessageId: assistantMessage.id,
                });
            }
        }

        return result;
    }

    private async processProjectReport(
        projectId: string,
        jobId?: string,
        periodStartStr?: string,
        periodEndStr?: string,
        reportType?: 'DAILY' | 'WEEKLY' | 'MONTHLY',
        generatedById?: string
    ) {
        // Get project
        const project = await this.databaseService.project.findUnique({
            where: { id: projectId },
            include: { organization: true },
        });

        if (!project) {
            throw new Error(`Project ${projectId} not found`);
        }

        // Parse dates or use defaults
        const periodEnd = periodEndStr ? new Date(periodEndStr) : new Date();
        const periodStart = periodStartStr ? new Date(periodStartStr) : new Date(periodEnd);
        if (!periodStartStr) {
            periodStart.setHours(periodStart.getHours() - 24);
        }

        const actualReportType = reportType || 'DAILY';

        // Generate report
        const reportResult = await this.llmService.generateProjectReport({
            projectId,
            periodStart,
            periodEnd,
            reportType: actualReportType,
            generatedById: generatedById || project.organization.ownerId,
        });

        // Fetch the created report
        const report = await this.databaseService.projectReport.findUnique({
            where: { id: reportResult.reportId },
            include: {
                generatedBy: true,
            },
        });

        // Emit completion event (could be used for SSE/WebSocket)
        // For now, job status is tracked in Job model

        return {
            reportId: reportResult.reportId,
            report,
        };
    }


    @OnWorkerEvent('failed')
    async onFailed(job, err) {
        this.logger.error(`LLM job failed: ${job.id} - ${err.message}`, LLMProcessor.name);
        
        const data = job.data as LLMJobPayload;
        const jobId = data.jobId;

        // Update job status to FAILED or RETRY
        if (jobId) {
            const dbJob = await this.databaseService.job.findUnique({
                where: { id: jobId },
            });

            if (dbJob) {
                const attempts = dbJob.attempts || 0;
                const maxAttempts = 3;

                if (attempts < maxAttempts) {
                    // Mark for retry
                    await this.databaseService.job.update({
                        where: { id: jobId },
                        data: {
                            status: JobStatus.RETRY,
                            attempts: { increment: 1 },
                        },
                    });
                } else {
                    // Mark as failed after max attempts
                    await this.databaseService.job.update({
                        where: { id: jobId },
                        data: {
                            status: JobStatus.FAILED,
                            payload: {
                                ...(dbJob.payload as any),
                                error: err.message,
                                failedAt: new Date().toISOString(),
                            },
                        },
                    });

                    // Emit failure event for chat
                    if (data.mode === 'chat' && data.conversationId) {
                        await this.chatGateway.emitToConversation(data.conversationId, 'messageProcessing', {
                            conversationId: data.conversationId,
                            userMessageId: data.userMessageId,
                            jobId,
                            status: 'failed',
                            error: err.message,
                        });
                    }
                }
            }
        }
    }
}