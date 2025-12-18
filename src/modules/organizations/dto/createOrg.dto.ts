import { Type } from "class-transformer";
import { IsArray, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateNested } from "class-validator"
import { ExternalProvider, PredefinedOrgRole } from "generated/prisma/enums";

export class CreateOrgDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => InviteMemberDto)
    inviteMembers?: InviteMemberDto[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => AppProviderDto)
    appProviders?: AppProviderDto[];
}

export class AppProviderDto {
    @IsEnum(ExternalProvider)
    provider: ExternalProvider;
}

export class InviteMemberDto {
    @IsEmail()
    email: string;

    @IsEnum(PredefinedOrgRole)
    predefinedRole: PredefinedOrgRole;
}