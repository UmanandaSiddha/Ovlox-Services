import { IsString, IsOptional } from 'class-validator';

export class AddTeamMemberDto {
    @IsString()
    memberId: string;

    @IsString()
    @IsOptional()
    role?: string;
}
