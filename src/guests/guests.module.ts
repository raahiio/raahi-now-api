import { Module } from '@nestjs/common';
import { RateLimiter } from '../common/rate-limit.js';
import { ClaimsController } from './claims.controller.js';
import { GuestAuthGuard } from './guest-auth.guard.js';
import { GuestIdentitiesService } from './guest-identities.service.js';

@Module({
  controllers: [ClaimsController],
  providers: [GuestIdentitiesService, GuestAuthGuard, RateLimiter],
  exports: [GuestIdentitiesService, GuestAuthGuard, RateLimiter],
})
export class GuestsModule {}
