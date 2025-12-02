import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from 'src/config/constants';

@Injectable()
export class RedisService {

    constructor(@Inject(REDIS_CLIENT) private client: Redis) { }

    private readonly USER_TO_SOCKET = 'socket:userToSocket';
    private readonly SOCKET_TO_USER = 'socket:socketToUser';

    // --- Caching ---
    async get(key: string): Promise<string | null> {
        try {
            return await this.client.get(key);
        } catch (error) {
            console.error(`Redis GET error for key ${key}:`, error);
            return null;
        }
    }

    async set(key: string, value: string, ttl?: number): Promise<void> {
        try {
            if (ttl) {
                await this.client.set(key, value, 'EX', ttl);
            } else {
                await this.client.set(key, value);
            }
        } catch (error) {
            console.error(`Redis SET error for key ${key}:`, error);
        }
    }

    async del(...keys: string[]): Promise<number> {
        try {
            return await this.client.del(...keys);
        } catch (error) {
            console.error(`Redis DEL error:`, error);
            return 0;
        }
    }

    async keys(pattern: string): Promise<string[]> {
        try {
            return await this.client.keys(pattern);
        } catch (error) {
            console.error(`Redis KEYS error for pattern ${pattern}:`, error);
            return [];
        }
    }

    async exists(key: string): Promise<boolean> {
        try {
            const result = await this.client.exists(key);
            return result === 1;
        } catch (error) {
            console.error(`Redis EXISTS error for key ${key}:`, error);
            return false;
        }
    }

    async expire(key: string, seconds: number): Promise<boolean> {
        try {
            const result = await this.client.expire(key, seconds);
            return result === 1;
        } catch (error) {
            console.error(`Redis EXPIRE error for key ${key}:`, error);
            return false;
        }
    }

    async ttl(key: string): Promise<number> {
        try {
            return await this.client.ttl(key);
        } catch (error) {
            console.error(`Redis TTL error for key ${key}:`, error);
            return -1;
        }
    }

    async flushAll() {
        try {
            return await this.client.flushall();
        } catch (error) {
            console.error('Redis FLUSHALL error:', error);
            return null
        }
    }

    // --- Hash Commands ---
    async hSet(hashKey: string, field: string, value: string): Promise<void> {
        try {
            await this.client.hset(hashKey, field, value);
        } catch (error) {
            console.error(`Redis HSET error for key ${hashKey}, field ${field}:`, error);
        }
    }

    async hGet(hashKey: string, field: string): Promise<string | null> {
        try {
            return await this.client.hget(hashKey, field);
        } catch (error) {
            console.error(`Redis HGET error for key ${hashKey}, field ${field}:`, error);
            return null;
        }
    }

    async hDel(hashKey: string, field: string | string[]): Promise<number> {
        if (Array.isArray(field)) {
            return await this.client.hdel(hashKey, ...field);
        } else {
            return await this.client.hdel(hashKey, field);
        }
    }

    async hGetAll(hashKey: string): Promise<Record<string, string>> {
        try {
            return await this.client.hgetall(hashKey);
        } catch (error) {
            console.error(`Redis HGETALL error for key ${hashKey}:`, error);
            return {};
        }
    }

    // --- Z Commands ---
    async zAdd(key: string, score: number, member: string): Promise<void> {
        try {
            await this.client.zadd(key, score, member);
        } catch (error) {
            console.error(`Redis ZADD error for key ${key}:`, error);
        }
    }

    async zRange(key: string, start: number, stop: number): Promise<string[]> {
        try {
            return await this.client.zrange(key, start, stop);
        } catch (error) {
            console.error(`Redis ZRANGE error for key ${key}:`, error);
            return [];
        }
    }

    async zRevrange(key: string, start: number, stop: number): Promise<string[]> {
        try {
            return await this.client.zrevrange(key, start, stop);
        } catch (error) {
            console.error(`Redis ZREVRANGE error for key ${key}:`, error);
            return [];
        }
    }

    // --- Socket Components ---
    async registerSocket(userId: string, socketId: string): Promise<void> {
        try {
            await this.hSet(this.USER_TO_SOCKET, userId, socketId);
            await this.hSet(this.SOCKET_TO_USER, socketId, userId);
        } catch (error) {
            console.error(`registerSocket Failed`, error);
        }
    }

    async getSocketIdByUser(userId: string): Promise<string | null> {
        try {
            return await this.hGet(this.USER_TO_SOCKET, userId);
        } catch (error) {
            console.error(`getSocketIdByUser Failed`, error);
            return null;
        }
    }

    async getUserBySocket(socketId: string): Promise<string | null> {
        try {
            return await this.hGet(this.SOCKET_TO_USER, socketId);
        } catch (error) {
            console.error(`getUserBySocket Failed`, error);
            return null;
        }
    }

    async unregisterSocket(socketId: string): Promise<void> {
        try {
            const userId = await this.getUserBySocket(socketId);
            if (userId) {
                await this.hDel(this.SOCKET_TO_USER, socketId);
                await this.hDel(this.USER_TO_SOCKET, userId);
            }
        } catch (error) {
            console.error(`unregisterSocket Failed`, error);
        }
    }
}