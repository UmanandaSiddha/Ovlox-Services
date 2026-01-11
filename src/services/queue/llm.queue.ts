import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { LLM_QUEUE } from 'src/config/constants';

export interface LLMJobPayload {
    rawEventId?: string;
    mode: 'summary' | 'embedding' | 'chat' | 'project_report';
    question?: string;
    projectId?: string;
    conversationId?: string;
    userId?: string;
    organizationId?: string; // For chat and reports
    jobId?: string; // Link to Job model for tracking
    userMessageId?: string; // For chat - the user message that triggered this
    periodStart?: string; // For reports
    periodEnd?: string; // For reports
    reportType?: 'DAILY' | 'WEEKLY' | 'MONTHLY'; // For reports
    generatedById?: string; // For reports
}

@Injectable()
export class LLMQueue {
    constructor(
        @InjectQueue(LLM_QUEUE) private readonly queue: Queue,
    ) { }

    async enqueue(job: LLMJobPayload) {
        return this.queue.add('llm_task', job, {
            priority: 3,
            attempts: 2,
        });
    }
}