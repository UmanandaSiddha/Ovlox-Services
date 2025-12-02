import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from 'src/config/constants';

// Create a shared Redis configuration function
export const createRedisConnection = (configService: ConfigService): Redis => {
    const host = configService.get<string>('REDIS_HOST');
    const port = configService.get<number>('REDIS_PORT');
    const username = configService.get<string>('REDIS_USER');
    const password = configService.get<string>('REDIS_PASSWORD');

    // console.log({host,  port, username,  password})

    if (!host || !port || !password) {
        throw new Error('Missing Redis connection details in .env file.');
    }

    const config = {
        host,
        port,
        username,
        password,
        tls: {},
        // Enhanced retry strategy
        retryDelayOnFailover: 100,
        connectTimeout: 10000,
        lazyConnect: false,
        maxRetriesPerRequest: 3, // Keep this for your regular Redis operations
        retryStrategy: (times: number) => {
            const delay = Math.min(times * 2000, 30000);
            console.log(`Redis retry attempt ${times}, delay: ${delay}ms`);
            return delay;
        },
        // Connection pool settings
        enableReadyCheck: true,
        keepAlive: 30000,
        // Add proper error handling
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
    client.on('error', (err) => {
        console.error('Redis Client Error:', err.message);
        // Don't throw here, let the retry strategy handle it
    });

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