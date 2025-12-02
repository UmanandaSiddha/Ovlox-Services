import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit {
	constructor() {
		super();
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
}