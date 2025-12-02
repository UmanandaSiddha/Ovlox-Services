import { Controller, Delete, Get } from "@nestjs/common";
import { RedisHealthService } from "./health.service";

@Controller('health')
export class RedisHealthController {
    constructor(private readonly redisHealthService: RedisHealthService) { }

    @Get('redis-health')
    async checkRedis() {
        return await this.redisHealthService.checkAllConnections();
    }

    @Get('queue-stats')
    async queueStats() {
        return await this.redisHealthService.getQueueStats();
    }

    @Delete('flush')
    async flushAllQueues() {
        return this.redisHealthService.flushAllQueues();
    }
}