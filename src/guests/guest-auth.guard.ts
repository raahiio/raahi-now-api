import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestWithUser } from '../auth/current-user.decorator.js';
import { Clock } from '../common/clock.js';
import { AppError } from '../common/errors/app-error.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { callerKeys } from './caller-keys.js';
import { type ClaimedEvent, GuestIdentitiesService } from './guest-identities.service.js';
import { verifyManageToken } from './manage-token.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANAGE = /^Manage\s+(\S+)$/i;
const MAX_CODE_LENGTH = 64;

/** Set by GuestAuthGuard when a guest credential opened the event. */
export type RequestWithGuest = RequestWithUser & { guest?: ClaimedEvent };

const header = (req: Request, name: string): string | undefined => {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
};

/**
 * For routes an account or a guest can use. A signed-in user passes untouched (the account path
 * applies its own ownership rules). Otherwise `X-Claim-Code` or `Authorization: Manage <token>`
 * must open the event in the route's `:id`. A lock check comes first, so a locked caller is
 * refused even with the right code. Every miss is 401 `claim.invalid`, unknown event ids included.
 */
@Injectable()
export class GuestAuthGuard implements CanActivate {
  constructor(
    private readonly guests: GuestIdentitiesService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithGuest>();
    if (req.user) return true;

    const keys = callerKeys(req, this.env.DEVICE_HASH_SALT);
    await this.guests.assertNotLocked(keys);

    const eventId = String(req.params.id ?? '');
    const claimed = await this.authenticate(req, eventId);
    if (!claimed) {
      await this.guests.recordFailure(keys);
      throw new AppError(401, 'claim.invalid');
    }
    req.guest = claimed;
    return true;
  }

  /**
   * Read-path variant for public GETs: does this request's guest credential open `eventId`?
   * A missing, wrong or locked credential is simply anonymous (null). It never records a
   * failure, so a stray header on a GET cannot lock anyone out.
   */
  async peek(req: Request, eventId: string): Promise<ClaimedEvent | null> {
    const hasCredential = Boolean(header(req, 'x-claim-code')) || MANAGE.test(req.headers.authorization?.trim() ?? '');
    if (!hasCredential) return null;
    try {
      await this.guests.assertNotLocked(callerKeys(req, this.env.DEVICE_HASH_SALT));
    } catch (err) {
      if (err instanceof AppError) return null;
      throw err;
    }
    return this.authenticate(req, eventId);
  }

  private async authenticate(req: Request, eventId: string): Promise<ClaimedEvent | null> {
    if (!UUID.test(eventId)) return null;

    const code = header(req, 'x-claim-code')?.slice(0, MAX_CODE_LENGTH);
    if (code) return this.guests.codeOpensEvent(eventId, code);

    const manage = MANAGE.exec(req.headers.authorization?.trim() ?? '');
    if (manage?.[1]) {
      try {
        const claims = await verifyManageToken(manage[1], this.env.MANAGE_TOKEN_SECRET, this.clock.now());
        return claims.evt === eventId ? { identityId: claims.sub, eventId } : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}
