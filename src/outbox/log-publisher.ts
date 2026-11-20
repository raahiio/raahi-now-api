import { Injectable, Logger } from '@nestjs/common';
import { type Envelope, EventPublisher } from './event-publisher.js';

/** Logs type, id and subject only; the data payload is never written to logs. */
@Injectable()
export class LogPublisher extends EventPublisher {
  private readonly logger = new Logger('EventPublisher');

  async publish(envelope: Envelope): Promise<void> {
    this.logger.log(`${envelope.type} id=${envelope.id} subject=${envelope.subject.kind}:${envelope.subject.id}`);
  }
}
