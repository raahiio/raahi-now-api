import type { Request, Response } from 'express';

/**
 * Spec §2 caching: anonymous responses are shared-cacheable; anything carrying
 * Authorization is private and never stored. Every response varies on Authorization.
 */
export function applyCacheHeaders(req: Request, res: Response): void {
  res.setHeader('Vary', 'Authorization');
  res.setHeader('Cache-Control', req.headers.authorization ? 'private, no-store' : 'public, max-age=15');
}
