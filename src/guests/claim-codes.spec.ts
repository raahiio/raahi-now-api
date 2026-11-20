import { generateClaimCode, hashClaimCode, normalizeClaimCode } from './claim-codes.js';
import { signManageToken, verifyManageToken } from './manage-token.js';

const SECRET = 'a-secret-that-is-at-least-32-characters-long';

describe('claim codes', () => {
  it('generateClaimCode returns 12 characters from the Crockford alphabet', () => {
    expect(generateClaimCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
  });

  it('generateClaimCode does not repeat across 1000 calls', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateClaimCode()));
    expect(codes.size).toBe(1000);
  });

  it('hashClaimCode is deterministic, hex and secret-dependent', () => {
    const a = hashClaimCode('ABCDEFGH2345', SECRET);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashClaimCode('ABCDEFGH2345', SECRET)).toBe(a);
    expect(hashClaimCode('ABCDEFGH2345', `${SECRET}x`)).not.toBe(a);
    expect(hashClaimCode('ABCDEFGH2346', SECRET)).not.toBe(a);
  });

  it('normalizeClaimCode uppercases, strips spaces and hyphens and maps I/L to 1 and O to 0', () => {
    expect(normalizeClaimCode(' abcd-efgh 2345 ')).toBe('ABCDEFGH2345');
    expect(normalizeClaimCode('il-o')).toBe('110');
  });
});

describe('manage tokens', () => {
  const payload = { sub: 'guest-1', evt: 'event-1' };

  it('round-trip and a tampered token fails', async () => {
    const token = await signManageToken(payload, SECRET);
    expect(await verifyManageToken(token, SECRET)).toEqual(payload);
    const [h, p, s] = token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...payload, evt: 'event-2' })).toString('base64url')}.${s}`;
    await expect(verifyManageToken(forged, SECRET)).rejects.toThrow();
    await expect(verifyManageToken(`${h}.${p}.${s}x`, SECRET)).rejects.toThrow();
    await expect(verifyManageToken(token, `${SECRET}x`)).rejects.toThrow();
  });

  it('expires after 900 seconds', async () => {
    const now = new Date('2026-11-19T12:00:00Z');
    const token = await signManageToken(payload, SECRET, now);
    expect(await verifyManageToken(token, SECRET, new Date(now.getTime() + 899_000))).toEqual(payload);
    await expect(verifyManageToken(token, SECRET, new Date(now.getTime() + 901_000))).rejects.toThrow();
  });
});
