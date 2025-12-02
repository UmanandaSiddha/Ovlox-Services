import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { DatabaseModule } from 'src/services/database/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [DatabaseModule, AuthModule],
    providers: [OrganizationsService],
    controllers: [OrganizationsController],
    exports: [OrganizationsService],
})
export class OrganizationsModule { }