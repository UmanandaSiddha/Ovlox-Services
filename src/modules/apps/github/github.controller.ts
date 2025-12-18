import { Controller, Get, Query, Res, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { GithubIntegrationService } from './github.integration.service';

@Controller('api/v1/integrations/github')
export class GithubIntegrationController {
    constructor(private readonly github: GithubIntegrationService) { }


    // Step 1: redirect user to GitHub App install page
    @Get('install')
    install(@Query('orgId') orgId: string, @Res() res: Response) {
        if (!orgId) throw new HttpException('orgId required', HttpStatus.BAD_REQUEST);
        const url = this.github.getInstallUrl(orgId);
        return res.redirect(url);
    }


    // Step 2: callback after installation
    @Get('callback')
    async callback(@Query('installation_id') installationId: string, @Query('setup_action') setupAction: string, @Query('state') state: string, @Res() res: Response) {
        if (!installationId) throw new HttpException('installation_id required', HttpStatus.BAD_REQUEST);


        try {
            // state should contain orgId (signed/encrypted ideally)
            const orgId = state;
            await this.github.handleInstallation(installationId, orgId, setupAction);


            // redirect back to frontend setup page
            const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
            return res.redirect(`${frontend}/organizations/${orgId}/setup?connected=github`);
        } catch (err) {
            console.error(err);
            throw new HttpException('GitHub callback handling failed', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
