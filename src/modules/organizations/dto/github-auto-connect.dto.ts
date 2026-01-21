import { IsNotEmpty, IsString } from 'class-validator';

export class GithubAutoConnectDto {
    @IsString()
    @IsNotEmpty()
    sourceOrgId: string;
}

