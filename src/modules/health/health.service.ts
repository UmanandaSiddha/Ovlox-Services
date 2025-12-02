import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Inject } from '@nestjs/common';
import { EMAIL_QUEUE, INJESTION_QUEUE, LLM_QUEUE, REDIS_CLIENT, WEBHOOK_QUEUE } from 'src/config/constants';
import Redis from 'ioredis';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class RedisHealthService {
    private readonly logger = new Logger(RedisHealthService.name);

    constructor(
        @InjectQueue(INJESTION_QUEUE) private injestionQueue: Queue,
        @InjectQueue(LLM_QUEUE) private llmQueue: Queue,
        @InjectQueue(WEBHOOK_QUEUE) private webhookQueue: Queue,
        @InjectQueue(EMAIL_QUEUE) private emailQueue: Queue,
        @Inject(REDIS_CLIENT) private redisClient: Redis,
    ) { }

    async checkAllConnections() {
        const results = {
            mainRedis: await this.checkConnection(this.redisClient, 'Main Redis'),
            injestionQueue: await this.checkQueueConnection(this.injestionQueue, 'Injestion Queue'),
            llmQueue: await this.checkQueueConnection(this.llmQueue, 'LLM Queue'),
            webhookQueue: await this.checkQueueConnection(this.webhookQueue, 'Webhook Queue'),
            emailQueue: await this.checkQueueConnection(this.emailQueue, 'Email Queue'),
        };

        this.logger.log('Redis connections status:', results);
        return results;
    }

    private async checkConnection(client: Redis, name: string) {
        try {
            const start = Date.now();
            const result = await client.ping();
            const latency = Date.now() - start;

            return {
                status: result === 'PONG' ? 'healthy' : 'unhealthy',
                latency: `${latency}ms`,
                name
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                name
            };
        }
    }

    private async checkQueueConnection(queue: Queue, name: string) {
        try {
            const start = Date.now();
            const client = await queue.client;
            const result = await client.ping();
            const latency = Date.now() - start;

            // Also check queue stats
            const waiting = await queue.getWaitingCount();
            const active = await queue.getActiveCount();
            const failed = await queue.getFailedCount();

            return {
                status: result === 'PONG' ? 'healthy' : 'unhealthy',
                latency: `${latency}ms`,
                stats: { waiting, active, failed },
                name
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                name
            };
        }
    }

    async getQueueStats() {
        try {
            const injestionStats = {
                waiting: await this.injestionQueue.getWaitingCount(),
                active: await this.injestionQueue.getActiveCount(),
                completed: await this.injestionQueue.getCompletedCount(),
                failed: await this.injestionQueue.getFailedCount(),
                delayed: await this.injestionQueue.getDelayedCount(),
            };

            const llmStats = {
                waiting: await this.llmQueue.getWaitingCount(),
                active: await this.llmQueue.getActiveCount(),
                completed: await this.llmQueue.getCompletedCount(),
                failed: await this.llmQueue.getFailedCount(),
                delayed: await this.llmQueue.getDelayedCount(),
            };

            const webhookStats = {
                waiting: await this.webhookQueue.getWaitingCount(),
                active: await this.webhookQueue.getActiveCount(),
                completed: await this.webhookQueue.getCompletedCount(),
                failed: await this.webhookQueue.getFailedCount(),
                delayed: await this.webhookQueue.getDelayedCount(),
            };

            const emailStats = {
                waiting: await this.emailQueue.getWaitingCount(),
                active: await this.emailQueue.getActiveCount(),
                completed: await this.emailQueue.getCompletedCount(),
                failed: await this.emailQueue.getFailedCount(),
                delayed: await this.emailQueue.getDelayedCount(),
            };

            return {
                timestamp: new Date().toISOString(),
                injestionQueue: injestionStats,
                llmQueue: llmStats,
                webhookQueue: webhookStats,
                emailQueue: emailStats
            };
        } catch (error) {
            return {
                timestamp: new Date().toISOString(),
                error: error.message
            };
        }
    }

    async flushAllQueues() {
        try {
            const injestionFlushed = await this.flushQueue(this.injestionQueue, 'Injestion Queue');
            const llmFlushed = await this.flushQueue(this.llmQueue, 'LLM Queue');
            const webhookFlushed = await this.flushQueue(this.webhookQueue, 'Webhook Queue');
            const emailFlushed = await this.flushQueue(this.emailQueue, 'Email Queue');

            return {
                timestamp: new Date().toISOString(),
                flushed: [injestionFlushed, llmFlushed, webhookFlushed, emailFlushed],
            };
        } catch (error) {
            return {
                timestamp: new Date().toISOString(),
                error: error.message,
            };
        }
    }

    private async flushQueue(queue: Queue, name: string) {
        try {
            // Clear waiting/delayed jobs
            await queue.drain(true); // true = also remove delayed jobs

            // Clean active, completed, failed
            await queue.clean(0, 0, 'active');
            await queue.clean(0, 0, 'completed');
            await queue.clean(0, 0, 'failed');
            await queue.clean(0, 0, 'delayed');
            await queue.clean(0, 0, 'wait');

            return { name, status: 'flushed' };
        } catch (error) {
            return { name, status: 'error', error: error.message };
        }
    }

    @Cron(CronExpression.EVERY_30_SECONDS)
    async periodicHealthCheck() {
        try {
            const results = await this.checkAllConnections();
            const unhealthy = Object.values(results).filter(r => r.status === 'unhealthy');

            if (unhealthy.length > 0) {
                this.logger.error(`${unhealthy.length} Redis connections are unhealthy:`, unhealthy);
            }
        } catch (error) {
            this.logger.error('Health check failed:', error);
        }
    }
}