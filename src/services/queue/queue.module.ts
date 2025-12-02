import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getQueueName } from 'src/utils';
@Global()
@Module({
    imports: [
        BullModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const connectionConfig = {
                    host: configService.get<string>('REDIS_HOST'),
                    port: configService.get<number>('REDIS_PORT'),
                    username: configService.get<string>('REDIS_USER'),
                    password: configService.get<string>('REDIS_PASSWORD'),
                    tls: {},
                    retryDelayOnFailover: 100,
                    connectTimeout: 10000,
                    lazyConnect: false,
                    maxRetriesPerRequest: null, // BullMQ requires this to be null
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

        // Register queues with individual settings if needed
        BullModule.registerQueue(
            {
                name: getQueueName("HISTORY"),
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
            {
                name: getQueueName("WEBHOOK"),
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
            {
                name: getQueueName("LLM"),
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
            {
                name: getQueueName("LLM"),
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
        ),
    ],
    exports: [BullModule],
})
export class QueueModule { }