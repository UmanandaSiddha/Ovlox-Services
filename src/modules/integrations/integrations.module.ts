import { Module } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { DatabaseModule } from 'src/services/database/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [DatabaseModule, AuthModule],
    providers: [IntegrationsService],
    controllers: [IntegrationsController],
    exports: [IntegrationsService],
})
export class IntegrationsModule { }