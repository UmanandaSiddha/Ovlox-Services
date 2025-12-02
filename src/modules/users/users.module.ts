import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/services/database/database.module';
import { AuthModule } from 'src/modules/auth/auth.module';
import { UserController } from './users.controller';
import { UserService } from './users.service';

@Module({
    imports: [DatabaseModule, AuthModule],
    controllers: [UserController],
    providers: [UserService],
    exports: [UserService]
})
export class UserModule { }