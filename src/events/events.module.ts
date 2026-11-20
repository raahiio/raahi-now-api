import { Module } from '@nestjs/common';
import { GuestsModule } from '../guests/guests.module.js';
import { MarketsModule } from '../markets/markets.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { ReviewModule } from '../review/review.module.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [GuestsModule, MarketsModule, OutboxModule, ReviewModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
