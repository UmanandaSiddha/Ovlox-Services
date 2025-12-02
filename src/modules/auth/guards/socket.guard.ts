import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
} from '@nestjs/common';
import { Socket } from 'socket.io';
import { console } from 'inspector';
import { AuthService } from '../auth.service';

@Injectable()
export class SocketGuard implements CanActivate {
    constructor(private readonly authService: AuthService) { }

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
        const client: Socket = ctx.switchToWs().getClient<Socket>();
        const token = client.handshake.auth?.token as string | undefined;
        if (!token) {
            throw new UnauthorizedException('No auth token in socket handshake');
        }

        const user = await this.authService.validateUserByToken(token);
        console.log('SocketGuard user:', user);
        client.data.user = user;
        return true;
    }
}
