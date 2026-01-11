import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { LlmController, ReportsController } from './llm.controller';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from 'src/services/database/database.module';
import { LoggerModule } from 'src/services/logger/logger.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [ConfigModule, DatabaseModule, LoggerModule, AuthModule],
    providers: [LlmService],
    controllers: [LlmController, ReportsController],
    exports: [LlmService],
})
export class LlmModule { }