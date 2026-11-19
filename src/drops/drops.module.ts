import { Module } from '@nestjs/common';
import { MarketsModule } from '../markets/markets.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { ReviewModule } from '../review/review.module.js';
import { DropsController } from './drops.controller.js';
import { DropsService } from './drops.service.js';
import { LocalRequiredGuard } from './local-required.guard.js';

@Module({
  imports: [MarketsModule, OutboxModule, ReviewModule],
  controllers: [DropsController],
  providers: [DropsService, LocalRequiredGuard],
})
export class DropsModule {}
