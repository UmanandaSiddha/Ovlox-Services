import {
	IsEmail,
	IsNotEmpty,
	IsOptional,
	IsString,
	ValidateIf,
} from 'class-validator';

export class SignUpDto {
	@IsOptional()
	@IsString()
	@ValidateIf((obj) => !obj.email)
	phoneNumber: string;

	@IsOptional()
	@IsString()
	@IsEmail()
	@ValidateIf((obj) => !obj.phoneNumber)
	email: string;

	@IsString()
	@IsNotEmpty()
	firstName: string;

	@IsString()
	@IsNotEmpty()
	lastName: string;

	@IsString()
	@IsNotEmpty()
	password: string;
}
