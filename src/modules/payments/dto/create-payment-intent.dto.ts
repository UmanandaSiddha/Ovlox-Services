import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreatePaymentIntentDto {
    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsString()
    @IsOptional()
    currency?: string = 'usd';

    @IsNumber()
    @Min(1)
    creditsAmount: number;
}
