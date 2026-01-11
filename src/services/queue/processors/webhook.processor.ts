import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { WEBHOOK_QUEUE } from 'src/config/constants';
import { WebhookJobPayload } from '../webhook.queue';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { LoggerService } from 'src/services/logger/logger.service';
import { ExternalProvider } from 'generated/prisma/enums';

@Injectable()
@Processor(WEBHOOK_QUEUE)
export class WebhookProcessor extends WorkerHost {
    private readonly logger = new LoggerService(WebhookProcessor.name);

    constructor(
        private databaseService: DatabaseService,
    ) {
        super();
    }

    async process(job) {
        const data = job.data as WebhookJobPayload;

        this.logger.log(`Processing ${data.provider} webhook event`, WebhookProcessor.name);

        try {
            // Store webhook event for logging
            // Note: Provider-specific webhook handlers are called directly from controllers
            // This processor is a fallback for queued webhook events
            await this.databaseService.webhookEvent.create({
                data: {
                    provider: data.provider,
                    providerEventId: data.headers?.['x-github-event'] || data.payload?.id || Date.now().toString(),
                    payload: data.payload,
                },
            });

            // For now, webhook processing is handled directly in controllers
            // This processor logs the event for auditing
            return true;
        } catch (error) {
            this.logger.error(`Webhook processing failed for ${data.provider}: ${error.message}`, WebhookProcessor.name);
            throw error;
        }
    }

    @OnWorkerEvent('failed')
    onFailed(job, error) {
        this.logger.error(`Webhook job failed: ${job.id} - ${error}`, WebhookProcessor.name);
    }
}