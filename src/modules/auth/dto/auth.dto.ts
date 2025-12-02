import { IsEmail, IsOptional, IsString, ValidateIf } from "class-validator"

export class OtpDto {
    @IsString()
    @IsOptional()
    otpString: string;

    @IsOptional()
    @IsString()
    @ValidateIf((obj) => !obj.email)
    phoneNumber: string;

    @IsOptional()
    @IsString()
    @IsEmail()
    @ValidateIf((obj) => !obj.phoneNumber)
    email: string;
}