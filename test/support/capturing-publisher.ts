import { type Envelope, EventPublisher } from '../../src/outbox/event-publisher.js';

/** Records envelopes instead of publishing them; can be told to fail for an id or a subject. */
export class CapturingPublisher extends EventPublisher {
  published: Envelope[] = [];
  private failIds = new Set<string>();
  private failSubjects = new Set<string>();

  async publish(envelope: Envelope): Promise<void> {
    if (this.failIds.has(envelope.id) || this.failSubjects.has(envelope.subject.id)) {
      throw new Error(`publish failed for ${envelope.id}`);
    }
    this.published.push(envelope);
  }

  failFor(opts: { id?: string; subjectId?: string }): void {
    if (opts.id) this.failIds.add(opts.id);
    if (opts.subjectId) this.failSubjects.add(opts.subjectId);
  }

  clearFailures(): void {
    this.failIds.clear();
    this.failSubjects.clear();
  }

  clear(): void {
    this.published = [];
    this.clearFailures();
  }
}
