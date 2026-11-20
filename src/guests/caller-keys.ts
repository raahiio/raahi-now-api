import type { Request } from 'express';
import { deviceKey, hashKey } from '../common/device.js';
import type { CallerKeys } from './guest-identities.service.js';

/** Hashed device id (when sent) and hashed IP of a request. */
export function callerKeys(req: Pick<Request, 'headers' | 'ip'>, salt: string): CallerKeys {
  return { deviceHash: deviceKey(req, salt), ipHash: hashKey(req.ip ?? 'unknown', salt) };
}
