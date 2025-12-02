import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { createRedisConnection } from './redis.module';

export class RedisIoAdapter extends IoAdapter {
    private adapterConstructor: ReturnType<typeof createAdapter>;
    private readonly pubClient: Redis;
    private readonly subClient: Redis;

    constructor(app: any, private readonly configService: ConfigService) {
        super(app);

        // Use the shared Redis configuration
        this.pubClient = createRedisConnection(this.configService);
        this.subClient = createRedisConnection(this.configService);

        // Add specific event listeners for the adapter
        this.pubClient.on('error', (err) => {
            console.error('Redis Adapter Publisher Error:', err.message);
        });
        this.subClient.on('error', (err) => {
            console.error('Redis Adapter Subscriber Error:', err.message);
        });

        // Add connection success logs
        this.pubClient.on('ready', () => {
            console.log('Redis Publisher for Socket.IO adapter is ready');
        });
        this.subClient.on('ready', () => {
            console.log('Redis Subscriber for Socket.IO adapter is ready');
        });
    }

    async connectToRedis(): Promise<void> {
        try {
            this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
            console.log('RedisIoAdapter is ready.');
        } catch (error) {
            console.error('Failed to create Redis adapter. WebSockets will not be scalable.', error);
            throw error;
        }
    }

    createIOServer(port: number, options?: ServerOptions): any {
        const server = super.createIOServer(port, options);
        if (this.adapterConstructor) {
            server.adapter(this.adapterConstructor);
            console.log('Socket.IO server using Redis adapter');
        } else {
            console.warn('Redis adapter is not available. Running in standalone WebSocket mode.');
        }
        return server;
    }
}