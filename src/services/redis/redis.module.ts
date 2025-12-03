import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { REDIS_CLIENT } from 'src/config/constants';

export const createRedisConnection = (configService: ConfigService): Redis => {
    const host = configService.get<string>('REDIS_HOST');
    const port = configService.get<number>('REDIS_PORT');

    if (!host || !port) {
        throw new Error('Missing Redis connection details in .env file.');
    }

    const config: RedisOptions = {
        host,
        port,
        // retryDelayOnFailover: 100,
        connectTimeout: 10000,
        lazyConnect: false,
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => {
            const delay = Math.min(times * 2000, 30000);
            console.log(`Redis retry attempt ${times}, delay: ${delay}ms`);
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
            console.error('Redis connection error:', err.message);
            return targetErrors.some(targetError => err.message.includes(targetError)) ? 1 : false;
        },
    };

    const client = new Redis(config);

    // Enhanced logging
    client.on('connect', () => console.log(`Redis TCP connection established to ${host}:${port}`));
    client.on('ready', () => console.log('Redis is ready for commands'));
    client.on('end', () => console.warn('Redis connection closed. Attempting to reconnect...'));
    client.on('reconnecting', (ms: number) => console.log(`Redis reconnecting in ${ms}ms...`));
    client.on('error', (err) => console.error('Redis Client Error:', err.message));

    return client;
};

@Global()
@Module({
    imports: [ConfigModule],
    providers: [
        {
            provide: REDIS_CLIENT,
            inject: [ConfigService],
            useFactory: async (configService: ConfigService) => {
                const client = createRedisConnection(configService);
                console.log('Redis client created via RedisModule.');
                return client;
            },
        },
        RedisService,
    ],
    exports: [RedisService, REDIS_CLIENT],
})
export class RedisModule { }