import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ExternalProvider } from '@prisma/client';
import { Queue } from 'bullmq';
import { WEBHOOK_QUEUE } from 'src/config/constants';

export interface WebhookJobPayload {
    provider: ExternalProvider;
    headers: any;
    payload: any;
}

@Injectable()
export class WebhookQueue {
    constructor(
        @InjectQueue(WEBHOOK_QUEUE) private readonly queue: Queue,
    ) { }

    async enqueue(job: WebhookJobPayload) {
        return this.queue.add('webhook_event', job, {
            priority: 1, // real-time processing, high priority
        });
    }
}