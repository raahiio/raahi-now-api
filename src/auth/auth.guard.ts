import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../common/errors/app-error.js';
import type { RequestWithUser } from './current-user.decorator.js';
import { IdTokenVerifier } from './id-token-verifier.js';
import { AUTH_MODE_KEY } from './roles.decorator.js';
import { UsersService } from './users.service.js';

const BEARER = /^Bearer\s+(.*)$/i;

/**
 * Global. Attaches req.user when a Bearer token is present. A route without a marker is optional.
 * Non-Bearer schemes (e.g. `Manage <token>`) are ignored here. A present-but-bad Bearer token is
 * always 401 `auth.invalid_token`, even on optional routes.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IdTokenVerifier) private readonly verifier: IdTokenVerifier,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const mode = this.reflector.getAllAndOverride<string | undefined>(
      AUTH_MODE_KEY,
      [context.getHandler(), context.getClass()],
    );
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const header = req.headers.authorization;
    const match =
      typeof header === 'string' ? BEARER.exec(header.trim()) : null;

    if (!match) {
      if (mode === 'required') throw new AppError(401, 'auth.required');
      return true;
    }
    const token = (match[1] ?? '').trim();
    if (!token) throw new AppError(401, 'auth.invalid_token');

    const verified = await this.verifier.verify(token);
    req.user = await this.users.resolveCurrentUser(verified);
    return true;
  }
}
