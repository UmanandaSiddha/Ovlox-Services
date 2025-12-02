import { IsOptional, IsString } from "class-validator";

export class UserDetailsDto {
    @IsString()
    @IsOptional()
    email: string;

    @IsString()
    @IsOptional()
    phoneNumber: string;
}