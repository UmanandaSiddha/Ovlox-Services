import { Module } from '@nestjs/common';
import { ContributorsService } from './contributors.service';
import { ContributorsController } from './contributors.controller';
import { DatabaseModule } from 'src/services/database/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [DatabaseModule, AuthModule],
    providers: [ContributorsService],
    controllers: [ContributorsController],
    exports: [ContributorsService],
})
export class ContributorsModule {}
