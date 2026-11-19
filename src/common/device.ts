import { createHmac } from 'node:crypto';
import type { Request } from 'express';

const MAX_DEVICE_ID_LENGTH = 128;

/** HMAC-SHA256 of a value with the server salt, hex. Used for device ids and rate-limit keys. */
export function hashKey(value: string, salt: string): string {
  return createHmac('sha256', salt).update(value).digest('hex');
}

/** The hashed `X-Device-Id`, or null when the header is missing or blank. */
export function deviceKey(req: Pick<Request, 'headers'>, salt: string): string | null {
  const raw = req.headers['x-device-id'];
  const id = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!id || id.length > MAX_DEVICE_ID_LENGTH) return null;
  return hashKey(id, salt);
}
