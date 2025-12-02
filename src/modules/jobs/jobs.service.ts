import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { LoggerService } from 'src/services/logger/logger.service';

@Injectable()
export class JobsService {
    private readonly logger = new LoggerService(JobsService.name);

    constructor(
        private readonly databaseService: DatabaseService,
    ) { }

    // For v1 keep simple: persist job in DB and process in background worker (not provided here)
    async enqueue(type: string, payload: any) {
        const job = await this.databaseService.job.create({
            data: { type, payload },
        });
        this.logger.log(`Enqueued job ${job.id} type=${type}`, JobsService.name);
        return job;
    }

    // implement a poller (outside of request flow) that fetches pending jobs and processes them
    async fetchPending(limit = 10) {
        return this.databaseService.job.findMany({ where: { status: 'pending' }, take: limit });
    }

    async markDone(id: string) {
        return this.databaseService.job.update({ where: { id }, data: { status: 'done' } });
    }
}
