import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/services/database/database.module';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from 'src/modules/llm/llm.module';
import { AuthModule } from 'src/modules/auth/auth.module';
import { NotionIntegrationService } from './notion.service';
import { NotionController } from './notion.controller';

@Module({
    imports: [DatabaseModule, ConfigModule, LlmModule, AuthModule],
    providers: [NotionIntegrationService],
    controllers: [NotionController],
    exports: [NotionIntegrationService],
})
export class NotionModule { }
