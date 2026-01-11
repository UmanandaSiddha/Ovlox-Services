import { IsString } from 'class-validator';

export class UpdateContributorMapDto {
    @IsString()
    memberId: string;
}
