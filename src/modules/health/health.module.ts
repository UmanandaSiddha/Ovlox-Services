import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { RedisModule } from "src/services/redis/redis.module";
import { RedisHealthService } from "./health.service";
import { RedisHealthController } from "./health.controller";

@Module({
    imports: [BullModule, RedisModule, ScheduleModule.forRoot()],
    providers: [RedisHealthService],
    exports: [RedisHealthService],
    controllers: [RedisHealthController]
})
export class HealthModule { }