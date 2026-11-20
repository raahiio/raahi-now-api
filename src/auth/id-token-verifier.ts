export interface VerifiedToken {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  roles: string[];
}

/** Also the injection token. Implementations throw AppError(401, 'auth.invalid_token') on a bad token. */
export abstract class IdTokenVerifier {
  abstract verify(token: string): Promise<VerifiedToken>;
}
