import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { callerKeys } from './caller-keys.js';
import { ExchangeClaimDto, RecoverClaimDto } from './claims.dto.js';
import { GuestIdentitiesService } from './guest-identities.service.js';

@Controller('claims')
export class ClaimsController {
  constructor(
    private readonly guests: GuestIdentitiesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('exchange')
  @HttpCode(200)
  exchange(@Body() dto: ExchangeClaimDto, @Req() req: Request) {
    return this.guests.exchange(dto.code, callerKeys(req, this.env.DEVICE_HASH_SALT));
  }

  @Post('recover')
  @HttpCode(202)
  async recover(@Body() dto: RecoverClaimDto, @Req() req: Request) {
    await this.guests.recover(dto.email, req.ip ?? 'unknown');
    return { status: 'ok' as const };
  }
}
