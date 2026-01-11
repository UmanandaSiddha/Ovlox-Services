import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class LinkFeatureEventDto {
    @IsString()
    rawEventId: string;

    @IsNumber()
    @IsOptional()
    @Min(0)
    @Max(1)
    relevance?: number = 1.0;
}
