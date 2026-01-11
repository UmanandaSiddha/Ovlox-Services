import { IsString, IsOptional, IsEnum } from 'class-validator';
import { FeatureStatus } from 'generated/prisma/enums';

export class UpdateFeatureDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsEnum(FeatureStatus)
    @IsOptional()
    status?: FeatureStatus;
}
