import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { PredefinedOrgRole } from 'generated/prisma/enums';

export class InviteMemberDto {
    @IsEmail()
    email: string;

    @IsOptional()
    @IsEnum(PredefinedOrgRole)
    predefinedRole?: PredefinedOrgRole;

    @IsOptional()
    @IsString()
    roleId?: string;
}
