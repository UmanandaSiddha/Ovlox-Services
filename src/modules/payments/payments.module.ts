import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController, PaymentsWebhookController } from './payments.controller';
import { DatabaseModule } from 'src/services/database/database.module';
import { LoggerModule } from 'src/services/logger/logger.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [DatabaseModule, LoggerModule, ConfigModule, AuthModule],
    providers: [PaymentsService],
    controllers: [PaymentsController, PaymentsWebhookController],
    exports: [PaymentsService],
})
export class PaymentsModule {}
