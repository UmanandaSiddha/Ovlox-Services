import { Controller, Post, Get, Body, Param, UseGuards, Query } from '@nestjs/common';
import { S3Service } from './s3.service';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorator/permission.decorator';
import { PermissionName } from 'generated/prisma/enums';
import { GetPresignedUploadUrlDto } from './dto/presigned-url.dto';

@Controller('orgs/:orgId/storage')
@UseGuards(AuthGuard, PermissionGuard)
export class StorageController {
    constructor(private readonly s3Service: S3Service) { }

    @Post('presigned-upload')
    @RequirePermission(PermissionName.MANAGE_ORG)
    async getPresignedUploadUrl(
        @Param('orgId') orgId: string,
        @Body() dto: GetPresignedUploadUrlDto,
        @getUser('id') userId: string,
        @Query('projectId') projectId?: string,
    ) {
        let key: string;

        if (dto.folder === 'project' && projectId) {
            key = this.s3Service.generateProjectMediaKey(orgId, projectId, dto.filename);
        } else if (dto.folder === 'user') {
            key = this.s3Service.generateUserMediaKey(userId, dto.filename);
        } else {
            // Default to org folder
            key = this.s3Service.generateOrgMediaKey(orgId, dto.filename);
        }

        const url = await this.s3Service.getPresignedUploadUrl(
            key,
            dto.contentType,
            dto.expiresIn,
        );

        return {
            uploadUrl: url,
            key,
            expiresIn: dto.expiresIn || 3600,
        };
    }

    @Get('presigned-download')
    @RequirePermission(PermissionName.VIEW_PROJECTS)
    async getPresignedDownloadUrl(
        @Param('orgId') orgId: string,
        @Query('key') key: string,
        @Query('expiresIn') expiresIn?: string,
    ) {
        const url = await this.s3Service.getPresignedDownloadUrl(
            key,
            expiresIn ? parseInt(expiresIn) : 3600,
        );

        return {
            downloadUrl: url,
            expiresIn: expiresIn ? parseInt(expiresIn) : 3600,
        };
    }
}
