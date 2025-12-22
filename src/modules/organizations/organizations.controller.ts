import { Controller, Post, Body, UseGuards, Get, Param, Query, Sse, Header } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { CreateOrgDto } from './dto/createOrg.dto';
import { QueryString } from 'src/utils/apiFeatures';
import { interval, Observable, switchMap } from 'rxjs';

@Controller('orgs')
@UseGuards(AuthGuard, RoleGuard)
export class OrganizationsController {
    constructor(private orgs: OrganizationsService) { }

    @UseGuards()
    @Post('create')
    async create(@getUser('id') userId: string, @Body() dto: CreateOrgDto) {
        return this.orgs.createOrg(userId, dto);
    }

    @Get('user')
    async userOrgs(@getUser('id') userId: string, @Query() filters: QueryString) {
        return this.orgs.userOrgs(userId, filters);
    }

    @Get('user/byId/:id')
    async userOrgById(@getUser('id') userId: string, @Param('id') orgId: string) {
        return this.orgs.userOrgById(userId, orgId);
    }

    @Get('user/bySlug/:slug')
    async userOrgBySlug(@getUser('id') userId: string, @Param('slug') slug: string) {
        return this.orgs.userOrgBySlug(userId, slug);
    }

    @Sse('integration/status/:slug')
    @Header('Cache-Control', 'no-cache')
    @Header('Content-Type', 'text/event-stream')
    @Header('Connection', 'keep-alive')
    integrationStatus(
        @getUser('id') userId: string,
        @Param('slug') slug: string
    ): Observable<MessageEvent> {
        return interval(5000).pipe(
            switchMap(async () => {
                const integrations = await this.orgs.integrationStatus(userId, slug);

                return {
                    data: integrations,
                } as MessageEvent;
            }),
        );
    }
}