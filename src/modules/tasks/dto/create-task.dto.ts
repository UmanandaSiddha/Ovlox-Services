import { IsString, IsOptional, IsInt, Min, Max, IsEnum, IsDateString } from 'class-validator';
import { TaskStatus, ExternalProvider } from 'generated/prisma/enums';

export class CreateTaskDto {
    @IsString()
    title: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsEnum(TaskStatus)
    @IsOptional()
    status?: TaskStatus = TaskStatus.TODO;

    @IsInt()
    @IsOptional()
    @Min(1)
    @Max(5)
    priority?: number;

    @IsDateString()
    @IsOptional()
    dueDate?: string;

    @IsDateString()
    @IsOptional()
    completionDeadline?: string;

    @IsEnum(ExternalProvider)
    @IsOptional()
    provider?: ExternalProvider;

    @IsString()
    @IsOptional()
    providerId?: string;

    @IsString()
    @IsOptional()
    autoDetectedFromId?: string;
}
