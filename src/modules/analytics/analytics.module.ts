import { Module } from '@nestjs/common';
import { CreditAnalyticsService } from './credit-analytics.service';
import { CreditAnalyticsController } from './credit-analytics.controller';
import { DatabaseModule } from 'src/services/database/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [DatabaseModule, AuthModule],
    providers: [CreditAnalyticsService],
    controllers: [CreditAnalyticsController],
    exports: [CreditAnalyticsService],
})
export class AnalyticsModule {}
