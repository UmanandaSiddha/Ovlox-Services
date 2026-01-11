import { IsString, IsOptional, IsInt, Min, Max, IsEnum, IsDateString } from 'class-validator';
import { TaskStatus } from 'generated/prisma/enums';

export class UpdateTaskDto {
    @IsString()
    @IsOptional()
    title?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsEnum(TaskStatus)
    @IsOptional()
    status?: TaskStatus;

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
}
