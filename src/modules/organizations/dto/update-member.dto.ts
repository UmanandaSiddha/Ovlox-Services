import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PredefinedOrgRole } from 'generated/prisma/enums';

export class UpdateMemberDto {
    @IsOptional()
    @IsEnum(PredefinedOrgRole)
    predefinedRole?: PredefinedOrgRole;

    @IsOptional()
    @IsString()
    roleId?: string;
}
