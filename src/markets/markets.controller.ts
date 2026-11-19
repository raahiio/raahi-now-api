import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { applyCacheHeaders } from '../common/cache-headers.js';
import { MarketsService } from './markets.service.js';

@Controller('markets')
export class MarketsController {
  constructor(private readonly markets: MarketsService) {}

  @Get()
  async list(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    applyCacheHeaders(req, res);
    return { items: await this.markets.list() };
  }
}
