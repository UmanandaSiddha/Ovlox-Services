import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { WEBHOOK_QUEUE } from 'src/config/constants';
import { WebhookJobPayload } from '../webhook.queue';
import { Injectable, Logger } from '@nestjs/common';
import { LLMQueue } from '../llm.queue';
import { DatabaseService } from 'src/services/database/database.service';
import { ExternalProvider } from '@prisma/client';
import { LoggerService } from 'src/services/logger/logger.service';

@Injectable()
@Processor(WEBHOOK_QUEUE)
export class WebhookProcessor extends WorkerHost {
    private readonly logger = new LoggerService(WebhookProcessor.name);

    constructor(
        private databaseService: DatabaseService,
        private llmQueue: LLMQueue,
    ) {
        super();
    }

    async process(job) {
        const data = job.data as WebhookJobPayload;

        this.logger.log(`Processing ${data.provider} webhook event`, WebhookProcessor.name);

        /**
         * TODO: Validate signatures
         * TODO: Parse payload correctly for each provider
         */
        const parsedEvent = {
            projectId: 'todo', // determine project mapping based on integration connection
            integrationId: 'todo',
            content: JSON.stringify(data.payload),
            source: data.provider.toUpperCase() as ExternalProvider,
            sourceId: Date.now().toString(),
        };

        const rawEvent = await this.databaseService.rawEvent.create({
            data: {
                projectId: parsedEvent.projectId,
                integrationId: parsedEvent.integrationId,
                content: parsedEvent.content,
                source: parsedEvent.source,
                sourceId: parsedEvent.sourceId,
                eventType: 'OTHER',
                timestamp: new Date(),
            },
        });

        // Send to LLM queue
        await this.llmQueue.enqueue({
            rawEventId: rawEvent.id,
            mode: 'summary',
        });

        return true;
    }
    @OnWorkerEvent('failed')
    onFailed(job, error) {
        this.logger.error(`Webhook job failed: ${job.id} - ${error}`, WebhookProcessor.name);
    }
}