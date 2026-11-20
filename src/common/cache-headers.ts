import type { Request, Response } from 'express';

/**
 * Spec §2 caching: anonymous responses are shared-cacheable; anything carrying
 * Authorization is private and never stored. Every response varies on Authorization and on
 * X-Claim-Code, the other credential that can turn a public read into an owner read.
 */
export function applyCacheHeaders(req: Request, res: Response): void {
  res.setHeader('Vary', 'Authorization, X-Claim-Code');
  res.setHeader('Cache-Control', req.headers.authorization ? 'private, no-store' : 'public, max-age=15');
}
