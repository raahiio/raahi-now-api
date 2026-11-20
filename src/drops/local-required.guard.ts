import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { RequestWithUser } from '../auth/current-user.decorator.js';
import { AppError } from '../common/errors/app-error.js';

/** Runs after the global auth guard: 403 `drop.local_required` unless the caller is a verified local. */
@Injectable()
export class LocalRequiredGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<RequestWithUser>().user;
    if (!user?.roles.includes('local') || !user.localId) throw new AppError(403, 'drop.local_required');
    return true;
  }
}
