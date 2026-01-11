import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppGateway } from './app.gateway';
import { LoggerModule } from './services/logger/logger.module';
import { QueueModule } from './services/queue/queue.module';
import { HealthModule } from './modules/health/health.module';
import { RedisModule } from './services/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/users/users.module';
import { DatabaseModule } from './services/database/database.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { LlmModule } from './modules/llm/llm.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { GithubModule } from './modules/providers/github/github.module';
import { DiscordModule } from './modules/providers/discord/discord.module';
import { SlackModule } from './modules/providers/slack/slack.module';
import { JiraModule } from './modules/providers/jira/jira.module';
import { NotionModule } from './modules/providers/notion/notion.module';
import { FigmaModule } from './modules/providers/figma/figma.module';

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
		}),
		EventEmitterModule.forRoot(),
		LoggerModule,
		QueueModule,
		HealthModule,
		RedisModule,
		AuthModule,
		UserModule,
		DatabaseModule,
		OrganizationsModule,
		ProjectsModule,
		LlmModule,
		WebhooksModule,
		JobsModule,
		IntegrationsModule,
		GithubModule,
		DiscordModule,
		SlackModule,
		JiraModule,
		NotionModule,
		FigmaModule,
	],
	controllers: [AppController],
	providers: [AppService, AppGateway],
})
export class AppModule { }