import { IsString, IsArray, IsOptional } from 'class-validator';

export class CreateTaskTeamDto {
    @IsString()
    name: string;

    @IsArray()
    @IsString({ each: true })
    memberIds: string[];
}
