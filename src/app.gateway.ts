import {
	ConnectedSocket,
	OnGatewayConnection,
	OnGatewayDisconnect,
	SubscribeMessage,
	WebSocketGateway,
	WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RedisService } from './services/redis/redis.service';
import { DatabaseService } from './services/database/database.service';
import { UseGuards } from '@nestjs/common';
import { SocketGuard } from './modules/auth/guards/socket.guard';
import { allowedOrigins } from './config/origin';

@WebSocketGateway({
	cors: {
		origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void): void => {
			if (!origin || allowedOrigins.includes(origin as string)) {
				callback(null, origin);
			} else {
				callback(new Error("Not allowed by CORS"));
			}
		},
	},
	// path: '/api/v1/sockets',
	transports: ['websocket'],
})
@UseGuards(SocketGuard)
export class AppGateway
	implements
	OnGatewayConnection,
	OnGatewayDisconnect {
	@WebSocketServer() public server: Server;

	constructor(
		private readonly redisService: RedisService,
		private readonly databaseService: DatabaseService,
	) { }

	async handleConnection(client: Socket) {
		if (client.conn.transport.name !== 'websocket') {
			return;
		}

		// Get user from SocketGuard (set in client.data.user)
		const user = client.data.user;
		if (!user) {
			// Fallback to query param for backward compatibility
			const userId = client.handshake.query?.userId as string;
			if (!userId) {
				client.disconnect();
				return;
			}
			await this.databaseService.user.update({
				where: { id: userId },
				data: { isOnline: true },
			});
			console.log('Connected User ID:', userId, 'Socket:', client.id);
			await this.redisService.registerSocket(userId, client.id);
		} else {
			// User authenticated via SocketGuard
			await this.databaseService.user.update({
				where: { id: user.id },
				data: { isOnline: true },
			});
			console.log('Connected User ID:', user.id, 'Socket:', client.id);
			await this.redisService.registerSocket(user.id, client.id);
		}
	}

	async handleDisconnect(client: Socket) {
		// Try to get user from SocketGuard first
		const user = client.data.user;
		let userId: string | null = null;

		if (user) {
			userId = user.id;
		} else {
			// Fallback to Redis lookup
			userId = await this.redisService.getUserBySocket(client.id);
		}

		if (userId) {
			await this.databaseService.user.update({
				where: { id: userId },
				data: { isOnline: false },
			});
			console.log('Disconnected User ID:', userId, 'Socket:', client.id);
			await this.redisService.unregisterSocket(client.id);
		}
	}

	@SubscribeMessage('joinRoom')
	handleJoinRoom(@ConnectedSocket() client: Socket, room: string) {
		client.join(room);
	}

	emitToRoom(room: string, event: string, data: any) {
		this.server.to(room).emit(event, data);
	}

	async emitToUser(userId: string, event: string, data: any) {
		const socketId = await this.redisService.getSocketIdByUser(
			userId,
		);
		console.log({ socketId })
		if (socketId) {
			this.server.to(socketId).emit(event, data);
		}
	}
}
