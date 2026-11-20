import { jwtVerify, SignJWT } from 'jose';

export const MANAGE_TOKEN_TTL_SECONDS = 900;
export interface ManageClaims {
  sub: string;
  evt: string;
}

const key = (secret: string) => new TextEncoder().encode(secret);

/** HS256, 900 s. `now` is injectable so tests and the app clock agree. */
export async function signManageToken(payload: ManageClaims, secret: string, now: Date = new Date()): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ evt: payload.evt })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt(iat)
    .setExpirationTime(iat + MANAGE_TOKEN_TTL_SECONDS)
    .sign(key(secret));
}

/** Throws on a bad signature, an expired token or missing claims. */
export async function verifyManageToken(token: string, secret: string, now: Date = new Date()): Promise<ManageClaims> {
  const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'], currentDate: now });
  if (typeof payload.sub !== 'string' || typeof payload.evt !== 'string') throw new Error('manage token claims');
  return { sub: payload.sub, evt: payload.evt };
}
