import { createHmac, randomInt } from 'node:crypto';

/** Crockford base32: no I, L, O or U. */
export const CLAIM_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CLAIM_CODE_LENGTH = 12;

export function generateClaimCode(): string {
  let code = '';
  for (let i = 0; i < CLAIM_CODE_LENGTH; i++) code += CLAIM_ALPHABET[randomInt(CLAIM_ALPHABET.length)];
  return code;
}

/** HMAC-SHA256 hex of the (already normalized) code. */
export function hashClaimCode(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code.toUpperCase()).digest('hex');
}

/** What a person might type: any case, spaces and hyphens, and Crockford's I/L for 1 and O for 0. */
export function normalizeClaimCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}
