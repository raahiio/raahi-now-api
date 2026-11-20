import { Module } from '@nestjs/common';
import { GuestsModule } from '../guests/guests.module.js';
import { MarketsModule } from '../markets/markets.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { ReviewModule } from '../review/review.module.js';
import { EventsController } from './events.controller.js';
import { PublicEventsController } from './public-events.controller.js';
import { PublicEventsRepository } from './public-events.repository.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [GuestsModule, MarketsModule, OutboxModule, ReviewModule],
  controllers: [EventsController, PublicEventsController],
  providers: [EventsService, PublicEventsRepository],
})
export class EventsModule {}
