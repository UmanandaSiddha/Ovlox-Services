import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { LLM_QUEUE } from 'src/config/constants';

export interface LLMJobPayload {
    rawEventId: string;
    mode: 'summary' | 'embedding' | 'chat' | 'project_report';
    question?: string;
    projectId?: string;
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