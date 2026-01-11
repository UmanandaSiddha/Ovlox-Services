import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { INJESTION_QUEUE } from 'src/config/constants';
import { IngestionJobPayload } from '../ingestion.queue';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { LoggerService } from 'src/services/logger/logger.service';

@Injectable()
@Processor(INJESTION_QUEUE)
export class IngestionProcessor extends WorkerHost {
    private readonly logger = new LoggerService(IngestionProcessor.name);

    constructor(
        private databaseService: DatabaseService,
    ) {
        super();
    }

    async process(job) {
        const data = job.data as IngestionJobPayload;

        this.logger.log(`Starting ingestion for ${data.type} on resource ${data.resourceId}`, IngestionProcessor.name);

        // Note: Ingestion is handled directly via provider service endpoints
        // This processor can be used for async ingestion jobs if needed
        // For now, ingestion endpoints call provider services directly
        
        this.logger.warn(`IngestionProcessor: Direct ingestion endpoints should be used instead of queue`, IngestionProcessor.name);
        
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