import { Module } from '@nestjs/common';
import { EventPublisher } from './event-publisher.js';
import { LogPublisher } from './log-publisher.js';
import { OutboxRelayService } from './outbox-relay.service.js';
import { OutboxService } from './outbox.service.js';

@Module({
  providers: [OutboxService, OutboxRelayService, { provide: EventPublisher, useClass: LogPublisher }],
  exports: [OutboxService, OutboxRelayService, EventPublisher],
})
export class OutboxModule {}
