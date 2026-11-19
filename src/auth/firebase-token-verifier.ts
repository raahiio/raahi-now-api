import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { AppError } from '../common/errors/app-error.js';
import { IdTokenVerifier, type VerifiedToken } from './id-token-verifier.js';

const APP_NAME = 'raahi-now-auth';

/** Verifies Firebase ID tokens. The Firebase app is created on the first verify, never at construction. */
export class FirebaseTokenVerifier extends IdTokenVerifier {
  private app: App | undefined;

  constructor(private readonly projectId: string) {
    super();
  }

  private getApp(): App {
    return (this.app ??=
      getApps().find((a) => a.name === APP_NAME) ??
      initializeApp({ projectId: this.projectId }, APP_NAME));
  }

  async verify(token: string): Promise<VerifiedToken> {
    try {
      const decoded = await getAuth(this.getApp()).verifyIdToken(token);
      if (!decoded.email) throw new Error('token has no email');
      const claim: unknown = decoded['roles'];
      return {
        uid: decoded.uid,
        email: decoded.email,
        emailVerified: decoded.email_verified === true,
        name: typeof decoded['name'] === 'string' ? decoded['name'] : undefined,
        roles: Array.isArray(claim)
          ? claim.filter((r): r is string => typeof r === 'string')
          : [],
      };
    } catch {
      throw new AppError(401, 'auth.invalid_token');
    }
  }
}
