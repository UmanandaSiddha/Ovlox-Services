import { Module, forwardRef } from '@nestjs/common';
import { LlmService } from './llm.service';
import { LlmController, ReportsController } from './llm.controller';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from 'src/services/database/database.module';
import { LoggerModule } from 'src/services/logger/logger.module';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { QueueModule } from 'src/services/queue/queue.module';

@Module({
    imports: [
        ConfigModule,
        DatabaseModule,
        LoggerModule,
        AuthModule,
        ChatModule,
        forwardRef(() => QueueModule),
    ],
    providers: [LlmService],
    controllers: [LlmController, ReportsController],
    exports: [LlmService],
})
export class LlmModule { }