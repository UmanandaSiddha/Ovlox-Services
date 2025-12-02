import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { INJESTION_QUEUE } from 'src/config/constants';
import { IngestionJobPayload } from '../ingestion.queue';
import { Injectable } from '@nestjs/common';
import { LLMQueue } from '../llm.queue';
import { DatabaseService } from 'src/services/database/database.service';
import { LoggerService } from 'src/services/logger/logger.service';

@Injectable()
@Processor(INJESTION_QUEUE)
export class IngestionProcessor extends WorkerHost {
    private readonly logger = new LoggerService(IngestionProcessor.name);

    constructor(
        private databaseService: DatabaseService,
        private llmQueue: LLMQueue,
    ) {
        super();
    }

    async process(job) {
        const data = job.data as IngestionJobPayload;

        this.logger.log(`Starting ingestion for ${data.type} on resource ${data.resourceId}`, IngestionProcessor.name);

        /**
         * TODO: Implement provider-specific ingestion logic.
         * Example:
         * - For GitHub: fetch commits using Octokit + installation token
         * - For Slack/Discord: fetch channel messages via pagination
         * - For Notion/Jira: list tasks and activity
         */

        // Example pseudo ingestion:
        const events = [
            {
                content: 'Example imported commit/message/event',
                timestamp: new Date(),
            },
        ];

        // Save RawEvents in DB
        for (const e of events) {
            const rawEvent = await this.databaseService.rawEvent.create({
                data: {
                    projectId: data.projectId,
                    integrationId: data.integrationId,
                    eventType: 'OTHER',
                    source: 'GITHUB',
                    sourceId: 'placeholder',
                    timestamp: e.timestamp,
                    content: e.content,
                },
            });

            await this.llmQueue.enqueue({
                rawEventId: rawEvent.id,
                mode: 'summary',
            });
        }

        return true;
    }

    @OnWorkerEvent('completed')
    onCompleted(job) {
        this.logger.log(`Ingestion job completed: ${job.id}`, IngestionProcessor.name);
    }

    @OnWorkerEvent('failed')
    onFailed(job, err) {
        this.logger.error(`Ingestion job failed: ${job.id} - ${err}`, IngestionProcessor.name);
    }
}