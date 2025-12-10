import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorator/permission.decorator';
import { AuthorizationService } from '../authorization.service';
import { PermissionName } from 'generated/prisma/enums';

@Injectable()
export class PermissionGuard implements CanActivate {
    constructor(private reflector: Reflector, private authorizationService: AuthorizationService) { }

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
        const permission = this.reflector.get<string>(PERMISSION_KEY, ctx.getHandler());
        if (!permission) return true;

        const req = ctx.switchToHttp().getRequest();
        const user = req.user;
        const orgId = req.params.orgId;

        if (!user || !orgId) throw new ForbiddenException('Invalid request');

        await this.authorizationService.assertOrgPermission(user.id, orgId, permission as PermissionName);
        return true;
    }
}
