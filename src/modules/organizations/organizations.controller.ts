import { Controller, Post, Body, UseGuards, Req, Get } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { AuthGuard } from '../auth/guards/auth.guard';

@Controller('orgs')
export class OrganizationsController {
    constructor(private orgs: OrganizationsService) { }

    @UseGuards()
    @Post('/')
    async create(@Req() req: any, @Body() body: { name: string }) {
        return this.orgs.createOrg(req.user.userId, body.name);
    }

    @UseGuards(AuthGuard)
    @Post(':id/invite')
    async invite(@Req() req: any, @Body() body: { orgId: string, email: string, role: string }) {
        return this.orgs.invite(body.orgId, body.email, body.role, req.user.userId);
    }

    @UseGuards(AuthGuard)
    @Post('invites/accept')
    async accept(@Req() req: any, @Body() body: { token: string }) {
        return this.orgs.acceptInvite(body.token, req.user.userId);
    }

    @UseGuards(AuthGuard)
    @Get('my')
    async myOrgs(@Req() req: any) {
        return this.orgs.listOrgsForUser(req.user.userId);
    }
}