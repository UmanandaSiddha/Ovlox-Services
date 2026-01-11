import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { LoggerService } from 'src/services/logger/logger.service';
import { shouldSkipPayments } from 'src/utils/environment.util';

@Injectable()
export class S3Service {
    private readonly s3Client: S3Client;
    private readonly bucket: string;
    private readonly region: string;
    private readonly logger = new LoggerService(S3Service.name);

    constructor(private readonly configService: ConfigService) {
        const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
        const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
        this.region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
        this.bucket = this.configService.get<string>('AWS_S3_BUCKET') || '';

        if (!accessKeyId || !secretAccessKey || !this.bucket) {
            this.logger.warn('AWS S3 credentials not configured. S3 operations will fail.', S3Service.name);
        }

        this.s3Client = new S3Client({
            region: this.region,
            credentials: accessKeyId && secretAccessKey ? {
                accessKeyId,
                secretAccessKey,
            } : undefined,
        });
    }

    /**
     * Generate presigned URL for uploading a file to S3
     * @param key - S3 object key (path)
     * @param contentType - MIME type of the file
     * @param expiresIn - URL expiration time in seconds (default: 1 hour)
     * @returns Presigned URL for PUT operation
     */
    async getPresignedUploadUrl(
        key: string,
        contentType: string,
        expiresIn: number = 3600,
    ): Promise<string> {
        if (!this.bucket) {
            throw new BadRequestException('S3 bucket not configured');
        }

        if (shouldSkipPayments()) {
            // In development, return a mock URL
            this.logger.log(`[DEV] Mock presigned URL generated for: ${key}`, S3Service.name);
            return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}?mock=true`;
        }

        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: contentType,
        });

        try {
            const url = await getSignedUrl(this.s3Client, command, { expiresIn });
            this.logger.log(`Presigned upload URL generated for: ${key}`, S3Service.name);
            return url;
        } catch (error) {
            this.logger.error(`Failed to generate presigned URL: ${error.message}`, S3Service.name);
            throw new BadRequestException(`Failed to generate presigned URL: ${error.message}`);
        }
    }

    /**
     * Generate presigned URL for downloading/viewing a file from S3
     * @param key - S3 object key (path)
     * @param expiresIn - URL expiration time in seconds (default: 1 hour)
     * @returns Presigned URL for GET operation
     */
    async getPresignedDownloadUrl(
        key: string,
        expiresIn: number = 3600,
    ): Promise<string> {
        if (!this.bucket) {
            throw new BadRequestException('S3 bucket not configured');
        }

        if (shouldSkipPayments()) {
            // In development, return a mock URL
            this.logger.log(`[DEV] Mock presigned download URL generated for: ${key}`, S3Service.name);
            return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}?mock=true`;
        }

        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        });

        try {
            const url = await getSignedUrl(this.s3Client, command, { expiresIn });
            this.logger.log(`Presigned download URL generated for: ${key}`, S3Service.name);
            return url;
        } catch (error) {
            this.logger.error(`Failed to generate presigned URL: ${error.message}`, S3Service.name);
            throw new BadRequestException(`Failed to generate presigned URL: ${error.message}`);
        }
    }

    /**
     * Generate S3 key for organization media
     */
    generateOrgMediaKey(orgId: string, filename: string): string {
        const timestamp = Date.now();
        const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
        return `orgs/${orgId}/media/${timestamp}-${sanitizedFilename}`;
    }

    /**
     * Generate S3 key for project media
     */
    generateProjectMediaKey(orgId: string, projectId: string, filename: string): string {
        const timestamp = Date.now();
        const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
        return `orgs/${orgId}/projects/${projectId}/media/${timestamp}-${sanitizedFilename}`;
    }

    /**
     * Generate S3 key for user media (avatars, etc.)
     */
    generateUserMediaKey(userId: string, filename: string): string {
        const timestamp = Date.now();
        const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
        return `users/${userId}/media/${timestamp}-${sanitizedFilename}`;
    }
}
