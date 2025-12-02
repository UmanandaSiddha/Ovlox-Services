import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { DatabaseModule } from 'src/services/database/database.module';

@Module({
    imports: [DatabaseModule],
    providers: [JobsService],
    exports: [JobsService],
})
export class JobsModule { }