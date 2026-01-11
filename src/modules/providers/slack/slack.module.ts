import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/services/database/database.module';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from 'src/modules/llm/llm.module';
import { AuthModule } from 'src/modules/auth/auth.module';
import { SlackService } from './slack.service';
import { SlackController } from './slack.controller';

@Module({
    imports: [DatabaseModule, ConfigModule, LlmModule, AuthModule],
    providers: [SlackService],
    controllers: [SlackController],
    exports: [SlackService],
})
export class SlackModule { }
