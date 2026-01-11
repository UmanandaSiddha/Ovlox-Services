import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/services/database/database.module';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from 'src/modules/llm/llm.module';
import { DiscordService } from './discord.service';
import { DiscordController } from './discord.controller';

@Module({
    imports: [DatabaseModule, ConfigModule, LlmModule],
    providers: [DiscordService],
    controllers: [DiscordController],
    exports: [DiscordService],
})
export class DiscordModule { }
