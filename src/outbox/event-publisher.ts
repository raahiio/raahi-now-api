export type Envelope = {
  id: string;
  type: string;
  v: 1;
  occurredAt: string;
  actor: { id: string | null };
  subject: { kind: string; id: string };
  data: Record<string, unknown>;
};

/** Where relayed outbox events go. Phase 1 only logs; a real transport replaces it later. */
export abstract class EventPublisher {
  abstract publish(envelope: Envelope): Promise<void>;
}
