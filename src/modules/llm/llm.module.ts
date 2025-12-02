import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from 'src/services/database/database.module';

@Module({
    imports: [ConfigModule, DatabaseModule],
    providers: [LlmService],
    exports: [LlmService],
})
export class LlmModule { }