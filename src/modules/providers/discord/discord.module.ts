import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/services/database/database.module';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from 'src/modules/llm/llm.module';
import { AuthModule } from 'src/modules/auth/auth.module';
import { DiscordService } from './discord.service';
import { DiscordController } from './discord.controller';

@Module({
    imports: [DatabaseModule, ConfigModule, LlmModule, AuthModule],
    providers: [DiscordService],
    controllers: [DiscordController],
    exports: [DiscordService],
})
export class DiscordModule { }
