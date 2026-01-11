import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/services/database/database.module';
import { AuthModule } from 'src/modules/auth/auth.module';
import { LlmModule } from 'src/modules/llm/llm.module';
import { GithubService } from './github.service';
import { GithubController } from './github.controller';

@Module({
    imports: [DatabaseModule, AuthModule, LlmModule],
    providers: [GithubService],
    controllers: [GithubController],
    exports: [GithubService],
})
export class GithubModule { }