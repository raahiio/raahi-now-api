import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MarketsService } from './markets.service.js';

@Controller('markets')
export class MarketsController {
  constructor(private readonly markets: MarketsService) {}

  @Get()
  async list(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Spec §2 caching: anonymous responses are shared-cacheable; anything carrying
    // Authorization is private and never stored. Every response varies on Authorization.
    res.setHeader('Vary', 'Authorization');
    res.setHeader(
      'Cache-Control',
      req.headers.authorization ? 'private, no-store' : 'public, max-age=15',
    );
    return { items: await this.markets.list() };
  }
}
