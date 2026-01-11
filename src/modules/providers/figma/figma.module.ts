import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/services/database/database.module';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from 'src/modules/llm/llm.module';
import { AuthModule } from 'src/modules/auth/auth.module';
import { FigmaService } from './figma.service';
import { FigmaController } from './figma.controller';

@Module({
    imports: [DatabaseModule, ConfigModule, LlmModule, AuthModule],
    providers: [FigmaService],
    controllers: [FigmaController],
    exports: [FigmaService],
})
export class FigmaModule { }
