import type { NextFunction, Request, Response } from 'express';
import { uuidv7 } from 'uuidv7';

export const REQUEST_ID_HEADER = 'X-Request-Id';
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Echo a well-formed incoming X-Request-Id, otherwise generate a UUIDv7. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const id = incoming !== undefined && SAFE_ID.test(incoming) ? incoming : uuidv7();
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}

export function requestIdOf(res: Response): string {
  return String(res.getHeader(REQUEST_ID_HEADER) ?? '');
}
