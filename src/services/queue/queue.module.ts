import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EMAIL_QUEUE, INJESTION_QUEUE, LLM_QUEUE, WEBHOOK_QUEUE } from 'src/config/constants';
import { IngestionQueue } from './ingestion.queue';
import { WebhookQueue } from './webhook.queue';
import { LLMQueue } from './llm.queue';
import { EmailQueue } from './email.queue';
import { IngestionProcessor } from './processors/ingestion.processor';
import { WebhookProcessor } from './processors/webhook.processor';
import { LLMProcessor } from './processors/llm.processor';
import { EmailProcessor } from './processors/email.processor';
import { LoggerModule } from '../logger/logger.module';
import { DatabaseModule } from '../database/database.module';
import { LlmModule } from '../../modules/llm/llm.module';
import { ConnectionOptions } from 'bullmq';

@Global()
@Module({
    imports: [
        LoggerModule,
        DatabaseModule,
        LlmModule,
        BullModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const connectionConfig: ConnectionOptions = {
                    host: configService.get<string>('REDIS_HOST'),
                    port: configService.get<number>('REDIS_PORT'),
                    retryDelayOnFailover: 100,
                    connectTimeout: 10000,
                    lazyConnect: false,
                    maxRetriesPerRequest: null,
                    retryStrategy: (times: number) => {
                        const delay = Math.min(times * 2000, 30000);
                        console.log(`BullMQ Redis retry attempt ${times}, delay: ${delay}ms`);
                        return delay;
                    },
                    enableReadyCheck: true,
                    keepAlive: 30000,
                    reconnectOnError: (err: Error) => {
                        const targetErrors = [
                            'READONLY',
                            'ECONNRESET',
                            'ENOTFOUND',
                            'ETIMEDOUT',
                            'Socket closed unexpectedly'
                        ];
                        console.error('BullMQ Redis error:', err.message);
                        return targetErrors.some(targetError => err.message.includes(targetError)) ? 1 : false;
                    },
                };

                console.log('BullMQ Redis configuration applied');

                return {
                    connection: connectionConfig,
                    defaultJobOptions: {
                        removeOnComplete: 50,
                        removeOnFail: 20,
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 2000,
                        },
                    },
                };
            },
        }),
        BullModule.registerQueue(
            {
                name: INJESTION_QUEUE,
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
            {
                name: WEBHOOK_QUEUE,
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
            {
                name: LLM_QUEUE,
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
            {
                name: EMAIL_QUEUE,
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
        ),
    ],
    providers: [
        IngestionQueue,
        WebhookQueue,
        LLMQueue,
        EmailQueue,
        IngestionProcessor,
        WebhookProcessor,
        LLMProcessor,
        EmailProcessor
    ],
    exports: [BullModule, IngestionQueue, WebhookQueue, LLMQueue, EmailQueue],
})
export class QueueModule { }