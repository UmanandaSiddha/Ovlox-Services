import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppGateway } from './app.gateway';
import { LoggerModule } from './services/logger/logger.module';
import { QueueModule } from './services/queue/queue.module';
import { HealthModule } from './modules/health/health.module';
import { RedisModule } from './services/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/users/users.module';
import { DatabaseModule } from './services/database/database.module';

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
		}),
		EventEmitterModule.forRoot(),
		LoggerModule,
		QueueModule,
		HealthModule,
		RedisModule,
		AuthModule,
		UserModule,
		DatabaseModule,
	],
	controllers: [AppController],
	providers: [AppService, AppGateway],
})
export class AppModule { }