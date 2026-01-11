import { IsString, IsOptional } from 'class-validator';

export class AssignTaskDto {
    @IsString()
    @IsOptional()
    assigneeId?: string;

    @IsString()
    @IsOptional()
    teamId?: string;
}
