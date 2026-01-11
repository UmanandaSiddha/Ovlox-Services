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
import { JobsModule } from './modules/jobs/jobs.module';
import { GithubModule } from './modules/providers/github/github.module';
import { DiscordModule } from './modules/providers/discord/discord.module';
import { SlackModule } from './modules/providers/slack/slack.module';
import { JiraModule } from './modules/providers/jira/jira.module';
import { NotionModule } from './modules/providers/notion/notion.module';
import { FigmaModule } from './modules/providers/figma/figma.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { FeaturesModule } from './modules/features/features.module';
import { ContributorsModule } from './modules/contributors/contributors.module';
import { RolesModule } from './modules/roles/roles.module';
import { StorageModule } from './modules/storage/storage.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ChatModule } from './modules/chat/chat.module';

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
		JobsModule,
		GithubModule,
		DiscordModule,
		SlackModule,
		JiraModule,
		NotionModule,
		FigmaModule,
		PaymentsModule,
		TasksModule,
		FeaturesModule,
		ContributorsModule,
		RolesModule,
		StorageModule,
		AnalyticsModule,
		ChatModule,
	],
	controllers: [AppController],
	providers: [AppService, AppGateway],
})
export class AppModule { }