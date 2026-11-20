import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from './roles.decorator.js';

export interface CurrentUser {
  id: string;
  firebaseUid: string;
  email: string;
  emailVerified: boolean;
  roles: Role[];
  localId: string | null;
  tz: string | null;
}

export type RequestWithUser = Request & { user?: CurrentUser };

/** The authenticated user, or undefined on an anonymous request to an optional route. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest<RequestWithUser>().user;
  },
);
