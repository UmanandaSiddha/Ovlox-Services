import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { LLM_QUEUE } from 'src/config/constants';
import { LLMJobPayload } from '../llm.queue';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { LoggerService } from 'src/services/logger/logger.service';

@Injectable()
@Processor(LLM_QUEUE)
export class LLMProcessor extends WorkerHost {
    private readonly logger = new LoggerService(LLMProcessor.name);

    constructor(
        private databaseService: DatabaseService,
    ) {
        super();
    }

    async process(job) {
        const data = job.data as LLMJobPayload;

        this.logger.log(`Processing LLM task mode=${data.mode}`, LLMProcessor.name);

        if (data.mode === 'summary') {
            return this.processSummary(data.rawEventId);
        }

        if (data.mode === 'chat') {
            return this.processChat(data.projectId!, data.question!);
        }

        return true;
    }

    private async processSummary(rawEventId: string) {
        const event = await this.databaseService.rawEvent.findUnique({ where: { id: rawEventId } });
        if (!event) return;

        const summary = `AI summary: ${event.content?.slice(0, 200)}`;

        const llm = await this.databaseService.llmOutput.create({
            data: {
                projectId: event.projectId,
                rawEventId,
                type: 'summary',
                content: summary,
                model: 'openai-stub',
            },
        });

        await this.databaseService.rawEvent.update({
            where: { id: event.id },
            data: { processedByLLM: true },
        });

        return llm;
    }

    private async processChat(projectId: string, question: string) {
        const context = await this.databaseService.llmOutput.findMany({
            where: { projectId },
            orderBy: { createdAt: 'desc' },
            take: 5,
        });

        const answer = `AI answer to "${question}" based on ${context.length} context items.`;

        return this.databaseService.llmOutput.create({
            data: {
                projectId,
                type: 'answer',
                content: answer,
                model: 'openai-stub',
            },
        });
    }

    @OnWorkerEvent('failed')
    onFailed(job, err) {
        this.logger.error(`LLM job failed: ${job.id} - ${err}`, LLMProcessor.name);
    }
}