import { Module } from '@nestjs/common';
import { MarketsModule } from '../markets/markets.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { ReviewModule } from '../review/review.module.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [MarketsModule, OutboxModule, ReviewModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
