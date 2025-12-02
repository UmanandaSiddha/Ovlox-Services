import {
	BadRequestException,
	Injectable,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';
import {
	OtpDto,
	SignUpDto,
	LoginDto,
} from './dto';
import { DatabaseService } from 'src/services/database/database.service';
import { User, AccountType, Prisma, AuthProvider } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from "crypto";
import { Request, Response } from 'express';
import { RequestDto } from './dto/request.dto';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {

	constructor(
		private readonly databaseService: DatabaseService,
		private readonly config: ConfigService,
		private readonly jwtService: JwtService,
	) { }

	// --- Helper Functions ---

	// Reusable contact condition builder
	private buildContactConditions(phone?: string, email?: string) {
		return [
			...(phone ? [{ phoneNumber: phone }] : []),
			...(email ? [{ email }] : [])
		];
	}

	// Verify user by token
	async validateUserByToken(token: string): Promise<User> {
		try {
			const secret = this.config.get<string>('ACCESS_TOKEN_SECRET');
			const payload: { id: string } = this.jwtService.verify(token, { secret });
			const user = await this.databaseService.user.findUnique({ where: { id: payload.id } });
			if (!user) {
				throw new UnauthorizedException('Invalid user.');
			}

			return user;
		} catch (err: any) {
			if (err.name === 'TokenExpiredError') {
				throw new UnauthorizedException('Token expired.');
			}
			throw new UnauthorizedException('Invalid token.');
		}
	}

	// Generate JWT Token
	async generateToken(user: User, type: "ACCESS_TOKEN" | "REFRESH_TOKEN"): Promise<string> {
		const secret = type === "ACCESS_TOKEN"
			? process.env.ACCESS_TOKEN_SECRET
			: process.env.REFRESH_TOKEN_SECRET;
		const expiresIn = type === "ACCESS_TOKEN" ? "15m" : "7d";

		return this.jwtService.sign({ id: user.id }, { secret, expiresIn });
	}

	// Generate 6 digit OTP
	async generateOTP(): Promise<{ otpString: string, otpToken: string, otpExpire: number }> {
		let otpString: string;
		if (process.env.NODE_ENV === "production") {
			otpString = Math.floor(100000 + Math.random() * 900000).toString();
		} else {
			otpString = '000000';
		}

		const otpToken = crypto
			.createHash("sha256")
			.update(otpString)
			.digest("hex");

		const otpExpire = Date.now() + 5 * 60 * 1000;

		return { otpString, otpToken, otpExpire }
	}

	// Send JWT Token to client cookies
	async sendToken(res: Response, type: "ACCESS_TOKEN" | "REFRESH_TOKEN", token: string): Promise<void> {
		const isProduction = process.env.NODE_ENV === 'production';
		const tokenName = type === "ACCESS_TOKEN" ? 'accessToken' : 'refreshToken';
		const age = type === "ACCESS_TOKEN" ? 15 : 7 * 24 * 60;

		res.cookie(tokenName, token, {
			httpOnly: true,
			secure: isProduction,
			sameSite: 'lax',
			maxAge: age * 60 * 1000,
			path: '/',
		});
	}

	// Clear client tokens
	async clearToken(res: Response, type: "ACCESS_TOKEN" | "REFRESH_TOKEN"): Promise<void> {
		const isProduction = process.env.NODE_ENV === 'production';
		const tokenName = type === "ACCESS_TOKEN" ? 'accessToken' : 'refreshToken';

		res.clearCookie(tokenName, {
			httpOnly: true,
			secure: isProduction,
			sameSite: 'lax',
			path: '/',
		});
	}

	// Validate if either phoneNumber or email is available
	validateContactInfo(phoneNumber?: string, email?: string) {
		if (!phoneNumber && !email) {
			throw new BadRequestException('Either phoneNumber or email is required!!');
		}
	}

	// --- Services ---

	// Request OTP
	async requestOtp(dto: RequestDto) {
		const { phoneNumber, email } = dto;
		this.validateContactInfo(phoneNumber, email);

		const userByEmail = email ? await this.databaseService.user.findUnique({
			where: { email }
		}) : null;
		const userByPhone = phoneNumber ? await this.databaseService.user.findUnique({
			where: { phoneNumber }
		}) : null;

		let user = userByEmail || userByPhone;
		if (!user) throw new BadRequestException('Invalid Request!!');

		const { otpString, otpToken, otpExpire } = await this.generateOTP();

		await this.databaseService.user.update({
			where: { id: user.id },
			data: {
				oneTimePassword: otpToken,
				oneTimeExpire: new Date(otpExpire),
			},
		});

		if (process.env.NODE_ENV === "production") {
			// await this.sendOtp(phoneNumber, otpString);
		}

		console.log("OTP: ", otpString);

		return { message: 'OTP sent successfully!!', success: true };
	}

	async signUp(dto: SignUpDto, res: Response) {
		const { phoneNumber, firstName, lastName, email, password } = dto;
		this.validateContactInfo(phoneNumber, email);

		const userByEmail = email ? await this.databaseService.user.findUnique({
			where: { email }
		}) : null;
		const userByPhone = phoneNumber ? await this.databaseService.user.findUnique({
			where: { phoneNumber }
		}) : null;
		const user = userByEmail || userByPhone;

		if (user) {
			if (user.isVerified) {
				throw new BadRequestException('User already exists !!');
			} else {
				await this.databaseService.user.delete({ where: { id: user.id } });
			}
		}

		const hashedPassword = await bcrypt.hash(password, 10);
		const { otpString, otpToken, otpExpire } = await this.generateOTP();

		const newUser = await this.databaseService.user.create({
			data: {
				firstName,
				lastName,
				password: hashedPassword,
				phoneNumber,
				email,
				authProvider: [AuthProvider.PASSWORD],
				accountType: email ? [AccountType.EMAIL] : [AccountType.PHONE],
				oneTimePassword: otpToken,
				oneTimeExpire: new Date(otpExpire)
			},
		});

		const accessToken = await this.generateToken(newUser, "ACCESS_TOKEN");
		const refreshToken = await this.generateToken(newUser, "REFRESH_TOKEN");

		await this.sendToken(res, "ACCESS_TOKEN", accessToken);
		await this.sendToken(res, "REFRESH_TOKEN", refreshToken);

		if (process.env.NODE_ENV === "production") {
			// await this.sendOtp(phoneNumber, otpString);

		}
		console.log("OTP: ", otpString);

		return { message: 'User registered successfully!!', data: newUser, accessToken, refreshToken };
	}

	async verifyOtp(dto: OtpDto, res: Response) {
		const { otpString, phoneNumber, email } = dto;
		const oneTimePassword = crypto.createHash("sha256").update(otpString).digest("hex");

		const whereClause: Prisma.UserWhereInput = {
			oneTimePassword,
			oneTimeExpire: { gt: new Date() },
		};

		if (email) {
			whereClause.email = email;
		} else if (phoneNumber) {
			whereClause.phoneNumber = phoneNumber;
		} else {
			throw new BadRequestException('Either email or phone number is required.');
		}

		const user = await this.databaseService.user.findFirst({
			where: whereClause,
		});
		if (!user) throw new BadRequestException('Invalid OTP or expired');

		const payload: Prisma.UserUpdateInput = {
			isVerified: true,
			oneTimePassword: null,
			oneTimeExpire: null,
		};

		const updatedUser = await this.databaseService.user.update({
			where: { id: user.id },
			data: payload
		});

		const accessToken = await this.generateToken(updatedUser, "ACCESS_TOKEN");
		const refreshToken = await this.generateToken(updatedUser, "REFRESH_TOKEN");

		await this.sendToken(res, "ACCESS_TOKEN", accessToken);
		await this.sendToken(res, "REFRESH_TOKEN", refreshToken);

		return { message: 'User verified successfully', data: updatedUser, accessToken, refreshToken };
	}

	async refreshToken(req: Request, res: Response) {
		const token = req.cookies?.['refreshToken'] || req.headers.authorization?.split(' ')?.[1];
		if (!token) throw new NotFoundException('Refresh token not found!!');

		const invalidToken = await this.databaseService.invalidatedToken.findFirst({
			where: { refreshToken: token },
		});
		if (invalidToken) throw new UnauthorizedException('Invalid refresh token!!');

		const decoded = this.jwtService.verify(token, { secret: process.env.REFRESH_TOKEN_SECRET });
		if (!decoded) throw new UnauthorizedException('Invalid refresh token!!');

		const user = await this.databaseService.user.findUnique({
			where: { id: decoded.id },
		});
		if (!user) throw new UnauthorizedException('Invalid refresh token!!');

		const accessToken = await this.generateToken(user, "ACCESS_TOKEN");
		await this.sendToken(res, "ACCESS_TOKEN", accessToken);

		return { message: 'User token refreshed successfully!!', accessToken };
	}

	async signIn(dto: LoginDto, res: Response) {
		const { phoneNumber, password, email } = dto;
		this.validateContactInfo(phoneNumber, email);

		const user = await this.databaseService.user.findFirst({
			where: {
				OR: [
					{ phoneNumber: phoneNumber ?? undefined },
					{ email: email ?? undefined }
				]
			},
		});
		if (!user) throw new BadRequestException('Invalid credentials!!');

		const isPasswordValid = await bcrypt.compare(password, user.password);
		if (!isPasswordValid) throw new BadRequestException('Invalid credentials!!');

		const accessToken = await this.generateToken(user, "ACCESS_TOKEN");
		const refreshToken = await this.generateToken(user, "REFRESH_TOKEN");

		await this.sendToken(res, "ACCESS_TOKEN", accessToken);
		await this.sendToken(res, "REFRESH_TOKEN", refreshToken);

		return { message: 'User logged in successfully!!', data: user, accessToken, refreshToken };
	}

	async logout(req: Request, res: Response, userId: string) {
		const refreshToken = req.cookies.refreshToken;

		if (refreshToken) {
			await this.databaseService.invalidatedToken.upsert({
				where: { refreshToken },
				update: {},
				create: { refreshToken, userId },
			});
		}

		await this.clearToken(res, "ACCESS_TOKEN");
		await this.clearToken(res, "REFRESH_TOKEN");

		return { success: true, message: 'User logged out successfully!!' }
	}
}
