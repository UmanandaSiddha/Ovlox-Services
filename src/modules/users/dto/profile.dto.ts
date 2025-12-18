import {
    IsDateString,
    IsEnum,
    IsOptional,
    IsString,
    IsUrl,
} from 'class-validator';
import { Gender } from 'generated/prisma/enums';

export class ProfileDto {
    @IsString()
    @IsOptional()
    firstName: string;

    @IsString()
    @IsOptional()
    lastName: string;

    @IsEnum(Gender)
    @IsOptional()
    gender?: Gender;

    @IsDateString()
    @IsOptional()
    dateOfBirth?: string;

    @IsUrl()
    @IsOptional()
    avatarUrl?: string;
}
