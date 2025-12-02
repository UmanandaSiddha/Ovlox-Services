import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { EMAIL_QUEUE } from 'src/config/constants';
import { EmailJobPayload } from '../email.queue';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
    private readonly logger = new Logger(EmailProcessor.name);

    constructor() {
        super();
    }

    async process(job) {
        const data = job.data as EmailJobPayload;

        this.logger.log(`Sending email to ${data.to}`);

        /**
         * TODO: Replace with your mail provider (SendGrid, SES, Resend)
         */
        console.log('Email sent (stub):', data);

        return true;
    }

    @OnWorkerEvent('failed')
    onFailed(job, err) {
        this.logger.error(`Email job failed: ${job.id}`, err);
    }
}