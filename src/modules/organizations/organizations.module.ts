import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { DatabaseModule } from 'src/services/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from 'src/services/queue/queue.module';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [DatabaseModule, AuthModule, QueueModule, ConfigModule],
    providers: [OrganizationsService],
    controllers: [OrganizationsController],
    exports: [OrganizationsService],
})
export class OrganizationsModule { }