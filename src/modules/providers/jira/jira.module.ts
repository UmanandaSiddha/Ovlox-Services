import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/services/database/database.module';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from 'src/modules/llm/llm.module';
import { AuthModule } from 'src/modules/auth/auth.module';
import { JiraIntegrationService } from './jira.service';
import { JiraController } from './jira.controller';

@Module({
    imports: [DatabaseModule, ConfigModule, LlmModule, AuthModule],
    providers: [JiraIntegrationService],
    controllers: [JiraController],
    exports: [JiraIntegrationService],
})
export class JiraModule { }
