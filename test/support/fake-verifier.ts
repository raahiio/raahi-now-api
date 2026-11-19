import { AppError } from '../../src/common/errors/app-error.js';
import {
  IdTokenVerifier,
  type VerifiedToken,
} from '../../src/auth/id-token-verifier.js';

/** Authorization header value: `Bearer test:<uid>:<email>:<roles csv>`. */
export function fakeToken(opts: {
  uid: string;
  email?: string;
  roles?: string[];
}): string {
  const email = opts.email ?? `${opts.uid}@example.com`;
  return `Bearer test:${opts.uid}:${email}:${(opts.roles ?? []).join(',')}`;
}

/** Accepts only the fakeToken format (without the `Bearer ` prefix). */
export class FakeVerifier extends IdTokenVerifier {
  async verify(token: string): Promise<VerifiedToken> {
    const parts = token.split(':');
    if (parts.length !== 4 || parts[0] !== 'test' || !parts[1] || !parts[2]) {
      throw new AppError(401, 'auth.invalid_token');
    }
    return {
      uid: parts[1],
      email: parts[2],
      emailVerified: true,
      roles: parts[3] ? parts[3].split(',') : [],
    };
  }
}
