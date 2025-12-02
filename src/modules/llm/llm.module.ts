import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from 'src/services/database/database.module';
import { LoggerModule } from 'src/services/logger/logger.module';

@Module({
    imports: [ConfigModule, DatabaseModule, LoggerModule],
    providers: [LlmService],
    exports: [LlmService],
})
export class LlmModule { }