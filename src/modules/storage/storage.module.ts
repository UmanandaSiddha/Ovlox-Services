import { Module } from '@nestjs/common';
import { S3Service } from './s3.service';
import { StorageController } from './storage.controller';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'src/services/logger/logger.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [ConfigModule, LoggerModule, AuthModule],
    providers: [S3Service],
    controllers: [StorageController],
    exports: [S3Service],
})
export class StorageModule {}
