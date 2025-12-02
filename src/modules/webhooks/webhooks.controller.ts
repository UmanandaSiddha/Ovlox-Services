import { Controller, Post, Req, Param, Body, Headers } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';

@Controller('webhooks')
export class WebhooksController {
    constructor(private jobs: JobsService) { }

    @Post(':provider')
    async receive(@Param('provider') provider: string, @Body() payload: any, @Headers() headers) {
        // Basic: persist webhook event (JobsService will handle details)
        await this.jobs.enqueue('webhook_received', { provider, payload, headers });
        return { ok: true };
    }
}