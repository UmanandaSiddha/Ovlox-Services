import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, getUser } from 'src/modules/auth/guards/auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { UserService } from './users.service';
import { ProfileDto } from './dto/profile.dto';
import { UserDetailsDto } from './dto/details.dto';
import { Roles } from '../auth/decorator/role.decorator';
import { QueryString } from 'src/utils/apiFeatures';
import { UserRole } from 'generated/prisma/enums';

@Controller('user')
@UseGuards(AuthGuard, RoleGuard)
export class UserController {
    constructor(private readonly userService: UserService) { }

    // COMPLETE-PROFILE
    @Post('update-profile')
    completeProfile(@Body() dto: ProfileDto, @getUser('id') userId: string) {
        return this.userService.updateProfile(dto, userId);
    }

    // UPDATE-DETAILS
    @Put('update-details')
    updateDetails(@Body() dto: UserDetailsDto, @getUser('id') userId: string) {
        return this.updateDetails(dto, userId);
    }

    // ME
    @Get('me')
    userProfile(@getUser('id') userId: string) {
        return this.userService.userProfile(userId);
    }

    // ALL-USERS
    @Roles(UserRole.ADMIN)
    @Get('all-users')
    getAllUsers(@Query() filters: QueryString) {
        return this.userService.getAllUsers(filters);
    }

    // USER BY ID
    @Roles(UserRole.ADMIN)
    @Get('user/:id')
    getUserById(@Param('id') id: string) {
        return this.userService.getUserById(id);
    }

    // DELETE USER
    @Roles(UserRole.ADMIN)
    @Delete('delete/:id')
    deleteUser(@Param('id') id: string) {
        return this.userService.deleteUser(id);
    }
}