import { Module } from '@nestjs/common';
import { GithubIntegrationController } from './github/github.controller';
import { GithubIntegrationService } from './github/github.integration.service';
import { GithubWebhookController } from './github/github.webhook.controller';
import { DatabaseService } from 'src/services/database/database.service';

@Module({
    controllers: [GithubIntegrationController, GithubWebhookController],
    providers: [GithubIntegrationService, DatabaseService],
    exports: [GithubIntegrationService],
})
export class IntegrationsModule { }