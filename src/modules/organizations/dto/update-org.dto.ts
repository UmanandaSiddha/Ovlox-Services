import { IsOptional, IsString } from 'class-validator';

export class UpdateOrgDto {
    @IsOptional()
    @IsString()
    name?: string;
}
