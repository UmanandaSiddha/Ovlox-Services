import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { LLM_QUEUE } from 'src/config/constants';
import { LLMJobPayload } from '../llm.queue';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { LoggerService } from 'src/services/logger/logger.service';
import { LlmService } from 'src/modules/llm/llm.service';

@Injectable()
@Processor(LLM_QUEUE)
export class LLMProcessor extends WorkerHost {
    private readonly logger = new LoggerService(LLMProcessor.name);

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly llmService: LlmService,
    ) {
        super();
    }

    async process(job) {
        const data = job.data as LLMJobPayload;

        this.logger.log(`Processing LLM task mode=${data.mode}`, LLMProcessor.name);

        try {
            if (data.mode === 'summary') {
                return await this.processSummary(data.rawEventId);
            }

            if (data.mode === 'chat') {
                if (!data.conversationId || !data.question || !data.userId) {
                    throw new Error('Chat mode requires conversationId, question, and userId');
                }
                
                return await this.processChat(data.conversationId, data.question, data.projectId, data.userId);
            }

            if (data.mode === 'project_report') {
                return await this.processProjectReport(data.projectId!);
            }

            this.logger.warn(`Unknown LLM mode: ${data.mode}`, LLMProcessor.name);
            return true;
        } catch (error) {
            this.logger.error(`LLM job processing failed: ${job.id} - ${error.message}`, LLMProcessor.name);
            throw error;
        }
    }

    private async processSummary(rawEventId: string) {
        // Use LlmService to process the RawEvent
        const llmOutput = await this.llmService.processRawEvent(rawEventId);
        return llmOutput;
    }

    private async processChat(conversationId: string, question: string, projectId: string | undefined, userId: string) {
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

        // Use LlmService chat method
        const result = await this.llmService.chat({
            conversationId,
            question,
            userId,
            projectId: actualProjectId,
            organizationId,
        });

        return result;
    }

    private async processProjectReport(projectId: string) {
        // Get project
        const project = await this.databaseService.project.findUnique({
            where: { id: projectId },
        });

        if (!project) {
            throw new Error(`Project ${projectId} not found`);
        }

        // Generate report for the last 24 hours (can be customized)
        const periodEnd = new Date();
        const periodStart = new Date(periodEnd);
        periodStart.setHours(periodStart.getHours() - 24);

        const report = await this.llmService.generateProjectReport({
            projectId,
            periodStart,
            periodEnd,
            reportType: 'DAILY',
        });

        return report;
    }


    @OnWorkerEvent('failed')
    onFailed(job, err) {
        this.logger.error(`LLM job failed: ${job.id} - ${err.message}`, LLMProcessor.name);
    }
}