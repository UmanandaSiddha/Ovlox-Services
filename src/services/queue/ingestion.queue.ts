import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { INJESTION_QUEUE } from 'src/config/constants';

export interface IngestionJobPayload {
    integrationId: string;
    projectId: string;
    resourceId: string;
    type: 'github_history' | 'slack_history' | 'discord_history' | 'notion_history' | 'jira_history';
}

@Injectable()
export class IngestionQueue {
    constructor(
        @InjectQueue(INJESTION_QUEUE) private readonly queue: Queue,
    ) { }

    async enqueue(job: IngestionJobPayload) {
        return this.queue.add('ingest', job, {
            priority: 2,
        });
    }
}