import {
	Injectable,
	CanActivate,
	ExecutionContext,
	UnauthorizedException,
	createParamDecorator,
} from '@nestjs/common';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorator/public.decorator';
import { AuthService } from '../auth.service';
import { User } from 'generated/prisma/client';

interface AuthenticatedRequest extends Request {
	user?: User;
}

@Injectable()
export class AuthGuard implements CanActivate {
	constructor(private readonly authService: AuthService, private reflector: Reflector) { }

	private extractToken(request: AuthenticatedRequest): string | undefined {
		return (
			request.cookies?.['accessToken'] ||
			request.headers.authorization?.split(' ')?.[1]
		);
	}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		]);

		if (isPublic) {
			return true;
		}

		const req = context.switchToHttp().getRequest<Request>();
		const token = this.extractToken(req);
		if (!token) throw new UnauthorizedException('No token.');

		const user: User = await this.authService.validateUserByToken(token);
		(req as any).user = user;
		return true;
	}
}

export const getUser = createParamDecorator(
	(data: keyof User | undefined, ctx: ExecutionContext) => {
		const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
		if (!request.user) {
			throw new UnauthorizedException('User not found in request.');
		}
		return data ? request.user[data] : request.user;
	},
);
