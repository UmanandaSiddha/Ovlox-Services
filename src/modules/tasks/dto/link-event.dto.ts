import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class LinkEventDto {
    @IsString()
    rawEventId: string;

    @IsString()
    relationship: string;

    @IsNumber()
    @IsOptional()
    @Min(0)
    @Max(1)
    relevance?: number = 1.0;
}
