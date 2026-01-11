import { IsString, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class GetPresignedUploadUrlDto {
    @IsString()
    filename: string;

    @IsString()
    contentType: string;

    @IsString()
    @IsOptional()
    folder?: 'org' | 'project' | 'user';

    @IsNumber()
    @IsOptional()
    @Min(60)
    @Max(3600 * 24) // Max 24 hours
    expiresIn?: number = 3600;
}

