import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { RedisModule } from "src/services/redis/redis.module";
import { RedisHealthService } from "./health.service";
import { RedisHealthController } from "./health.controller";
import { LoggerModule } from "src/services/logger/logger.module";

@Module({
    imports: [BullModule, RedisModule, ScheduleModule.forRoot(), LoggerModule],
    providers: [RedisHealthService],
    exports: [RedisHealthService],
    controllers: [RedisHealthController]
})
export class HealthModule { }