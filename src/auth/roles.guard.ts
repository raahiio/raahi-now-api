import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../common/errors/app-error.js';
import type { RequestWithUser } from './current-user.decorator.js';
import { ROLES_KEY, type Role } from './roles.decorator.js';

/** Global; runs after AuthGuard. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles || roles.length === 0) return true;
    const user = context.switchToHttp().getRequest<RequestWithUser>().user;
    if (!user) throw new AppError(401, 'auth.required');
    if (!roles.some((r) => user.roles.includes(r)))
      throw new AppError(403, 'forbidden');
    return true;
  }
}
