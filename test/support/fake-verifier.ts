import { AppError } from '../../src/common/errors/app-error.js';
import {
  IdTokenVerifier,
  type VerifiedToken,
} from '../../src/auth/id-token-verifier.js';

/** Authorization header value: `Bearer test:<uid>:<email>:<roles csv>[:unverified]`. */
export function fakeToken(opts: {
  uid: string;
  email?: string;
  roles?: string[];
  /** Defaults to true. */
  emailVerified?: boolean;
}): string {
  const email = opts.email ?? `${opts.uid}@example.com`;
  const suffix = opts.emailVerified === false ? ':unverified' : '';
  return `Bearer test:${opts.uid}:${email}:${(opts.roles ?? []).join(',')}${suffix}`;
}

/** Accepts only the fakeToken format (without the `Bearer ` prefix). */
export class FakeVerifier extends IdTokenVerifier {
  async verify(token: string): Promise<VerifiedToken> {
    const parts = token.split(':');
    const unverified = parts.length === 5 && parts[4] === 'unverified';
    if ((parts.length !== 4 && !unverified) || parts[0] !== 'test' || !parts[1] || !parts[2]) {
      throw new AppError(401, 'auth.invalid_token');
    }
    return {
      uid: parts[1],
      email: parts[2],
      emailVerified: !unverified,
      roles: parts[3] ? parts[3].split(',') : [],
    };
  }
}
