import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
	constructor(
		private configService: ConfigService
	) {
		const connectionString = configService.get<string>('DATABASE_URL') || process.env.DATABASE_URL;
		const adapter = new PrismaPg({ connectionString });

		super({
			adapter,
			log: ['query', 'info', 'warn', 'error'],
		});
	}

	async onModuleInit() {
		try {
			await this.$connect();
			console.log('Connected to the database successfully');
		} catch (error) {
			console.error('Failed to connect to the database:', error.message);
			throw new Error('Database connection error');
		}
	}

	async onModuleDestroy() {
		await this.$disconnect();
	}
}