import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthGuard } from './guards/auth.guard';
import { DatabaseModule } from 'src/services/database/database.module';
import { SocketGuard } from './guards/socket.guard';

@Module({
	imports: [
		ConfigModule,
		DatabaseModule,
		JwtModule.registerAsync({
			inject: [ConfigService],
			useFactory: async (configService: ConfigService) => ({
				secret: configService.getOrThrow<string>('ACCESS_TOKEN_SECRET'),
				signOptions: { expiresIn: '15m' },
			}),
		}),
	],
	controllers: [AuthController],
	providers: [AuthService, AuthGuard, SocketGuard],
	exports: [AuthService, JwtModule, AuthGuard, SocketGuard],
})
export class AuthModule { }
