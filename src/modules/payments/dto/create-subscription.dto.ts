import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateSubscriptionDto {
    @IsString()
    priceId: string;

    @IsString()
    planName: string;

    @IsNumber()
    @IsOptional()
    @Min(0)
    monthlyCredits?: number;
}
