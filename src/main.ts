import { AppModule } from './app.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { RedisIoAdapter } from './services/redis/redis.adapter';
import { allowedOrigins } from './config/origin';
import { LoggerService } from './services/logger/logger.service';
import { LoggingInterceptor } from './services/logger/logger.interceptor';

// --- Global process-level error handlers ---
process.on('unhandledRejection', (reason, promise) => {
	console.log("unhandledRejection at process level")
	console.error('Unhandled Rejection:', reason);
	// optionally: send logs to your LoggerService or external monitoring
});

process.on('uncaughtException', (error) => {
	console.log("unhandledException at process level")

	console.error('Uncaught Exception:', error);
	// optionally: graceful shutdown here
});

async function bootstrap() {
	ConfigModule.forRoot();
	const app = await NestFactory.create(
		AppModule,
		{ logger: ['debug', 'error', 'log', 'warn'] },
	);

	const configService = app.get(ConfigService);

	const redisIoAdapter = new RedisIoAdapter(
		app,
		configService,
	);
	await redisIoAdapter.connectToRedis();

	app.useWebSocketAdapter(redisIoAdapter);

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
			transformOptions: {
				enableImplicitConversion: true,
			},
		}),
	);

	// --- Api Logger ---
	const logger = app.get(LoggerService);
	app.useGlobalInterceptors(
		new LoggingInterceptor(logger),
	);

	// --- Global Prefix ---
	app.setGlobalPrefix('api/v1');

	const { httpAdapter } = app.get(HttpAdapterHost);
	app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));

	app.use(cookieParser());

	// --- Cors Configuration ---
	app.enableCors({
		origin: (
			origin: string | undefined,
			callback: (err: Error | null, allow?: boolean | string) => void): void => {
			if (!origin || allowedOrigins.includes(origin as string)) {
				callback(null, origin);
			} else {
				callback(
					new Error('Not allowed by CORS'),
				);
			}
		},
		methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
		credentials: true,
		allowedHeaders: ['Content-Type', 'Authorization'],
	}
	);

	const PORT = process.env.PORT || 4000;
	await app.listen(PORT).then(() => {
		console.log(`Server running on Port ${PORT}`);
	});
}

bootstrap();