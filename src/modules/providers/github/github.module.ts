import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/services/database/database.module';
import { AuthModule } from 'src/modules/auth/auth.module';
import { GithubService } from './github.service';
import { GithubController } from './github.controller';

@Module({
    imports: [DatabaseModule, AuthModule],
    providers: [GithubService],
    controllers: [GithubController],
    exports: [GithubService],
})
export class GithubModule { }