import { SetMetadata } from '@nestjs/common';

export type Role = 'local' | 'reviewer' | 'admin';

export const ROLES_KEY = 'auth:roles';
export const AUTH_MODE_KEY = 'auth:mode';

/** 403 `forbidden` unless the user holds at least one listed role. Implies @RequireAuth. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
/** Attaches req.user when a valid Bearer token is present; never rejects a missing token. */
export const OptionalAuth = () => SetMetadata(AUTH_MODE_KEY, 'optional');
/** 401 `auth.required` when there is no valid Bearer token. */
export const RequireAuth = () => SetMetadata(AUTH_MODE_KEY, 'required');
