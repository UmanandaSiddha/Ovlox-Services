import {
	Catch,
	ArgumentsHost,
	HttpStatus,
	HttpException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';
import { LoggerService } from './services/logger/logger.service';
import { Prisma } from 'generated/prisma/client';

@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
	private readonly logger = new LoggerService(AllExceptionsFilter.name);

	catch(exception: unknown, host: ArgumentsHost) {
		const ctx = host.switchToHttp();
		const response = ctx.getResponse<Response>();
		const request = ctx.getRequest<Request>();

		let status = HttpStatus.INTERNAL_SERVER_ERROR;
		let message: string | object = 'Internal server error';

		if (exception instanceof HttpException) {
			status = exception.getStatus();
			message = exception.getResponse();
		} else if (exception instanceof Prisma.PrismaClientValidationError) {
			status = 422;
			message = exception.message.replaceAll(/\n/g, ' ');
		} else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
			status = HttpStatus.BAD_REQUEST;

			switch (exception.code) {
				case 'P2002':
					message = `Unique constraint failed on: ${exception.meta?.target}`;
					break;

				case 'P2003':
					message = `Foreign key constraint failed on field: ${exception.meta?.field_name}`;
					break;

				case 'P2025':
					status = HttpStatus.NOT_FOUND;
					message = 'Record not found';
					break;

				default:
					message = exception.message;
			}
		} else if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
			status = HttpStatus.INTERNAL_SERVER_ERROR;
			message = 'Unknown database error';
		} else if (exception instanceof Prisma.PrismaClientRustPanicError) {
			status = HttpStatus.INTERNAL_SERVER_ERROR;
			message = 'Prisma Engine panicked — please restart the service.';
		} else if (exception instanceof Prisma.PrismaClientInitializationError) {
			status = HttpStatus.INTERNAL_SERVER_ERROR;
			message = 'Database initialization error. Check your connection URL.';
		} else {
			status = HttpStatus.INTERNAL_SERVER_ERROR;
			message = 'Something went wrong';
		}

		response.status(status).json({
			statusCode: status,
			timestamp: new Date().toISOString(),
			path: request.url,
			error: message,
		});

		this.logger.error(`Status ${status} - ${JSON.stringify(message)} - ${request.url}`, AllExceptionsFilter.name);
		console.error(`Status ${status} - ${JSON.stringify(message)} - ${request.url}`, AllExceptionsFilter.name);

		super.catch(exception, host);
	}
}