import { IsString } from 'class-validator';

export class CreateContributorMapDto {
    @IsString()
    identityId: string;

    @IsString()
    memberId: string;
}
