import { Response } from 'express';
import {
	Body,
	Controller,
	Get,
	Post,
	Put,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
	OtpDto,
	SignUpDto,
	LoginDto,
} from './dto';
import { AuthGuard, getUser } from './guards/auth.guard';
import { Request } from 'express';
import { RequestDto } from './dto/request.dto';

@Controller('auth')
export class AuthController {
	constructor(private readonly authService: AuthService) { }

	// REQUEST-OTP
	@Post('request-otp')
	requestOtp(@Body() dto: RequestDto) {
		return this.authService.requestOtp(dto);
	}

	// SIGN-UP
	@Post('sign-up')
	signUp(@Body() dto: SignUpDto, @Res({ passthrough: true }) res: Response) {
		return this.authService.signUp(dto, res);
	}

	// REFRESH-TOKEN
	@Get('refresh-token')
	refreshToken(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
		return this.authService.refreshToken(req, res);
	}

	// VERIFY-OTP
	@Post('verify-otp')
	verifyOtp(@Body() dto: OtpDto, @Res({ passthrough: true }) res: Response) {
		return this.authService.verifyOtp(dto, res);
	}

	// SIGN-IN
	@Post('sign-in')
	signIn(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
		return this.authService.signIn(dto, res);
	}

	// LOGOUT
	@UseGuards(AuthGuard)
	@Put('logout')
	async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response, @getUser('id') userId: string) {
		return this.authService.logout(req, res, userId);
	}
}
