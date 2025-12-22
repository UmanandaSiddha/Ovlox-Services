import { Module } from '@nestjs/common';
import { IntegrationsController } from './controllers/integrations.controller';
import { GithubIntegrationService } from './providers/github/github.integration.service';
import { SlackIntegrationService } from './providers/slack/slack.integration.service';
import { DiscordIntegrationService } from './providers/discord/discord.integration.service';
import { NotionIntegrationService } from './providers/notion/notion.integration.service';
import { JiraIntegrationService } from './providers/jira/jira.integration.service';
import { FigmaIntegrationService } from './providers/figma/figma.integration.service';
import { GithubWebhookController } from './webhooks/github.webhook.controller';
import { SlackWebhookController } from './webhooks/slack.webhook.controller';
import { DiscordWebhookController } from './webhooks/discord.webhook.controller';
import { DatabaseService } from '../services/database/database.service';


@Module({
    controllers: [IntegrationsController, GithubWebhookController, SlackWebhookController, DiscordWebhookController],
    providers: [
        GithubIntegrationService,
        SlackIntegrationService,
        DiscordIntegrationService,
        NotionIntegrationService,
        JiraIntegrationService,
        FigmaIntegrationService,
        DatabaseService,
    ],
    exports: [GithubIntegrationService],
})
export class IntegrationsModule { }