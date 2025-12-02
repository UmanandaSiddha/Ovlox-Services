import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { DatabaseModule } from 'src/services/database/database.module';
import { LoggerModule } from 'src/services/logger/logger.module';

@Module({
    imports: [DatabaseModule, LoggerModule],
    providers: [JobsService],
    exports: [JobsService],
})
export class JobsModule { }