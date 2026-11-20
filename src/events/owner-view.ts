import type { Kysely, Transaction } from 'kysely';
import type { Schema } from '../db/schema.js';
import { latestReview } from '../review/review-summary.js';
import { type PrivateEventView, serializeEvent } from './event.serializer.js';

type Executor = Kysely<Schema> | Transaction<Schema>;

/** Events joined with their market zone, private address and latest review decision: everything the owner view needs. */
export function ownerEventQuery(db: Executor) {
  return db
    .selectFrom('events')
    .innerJoin('markets', 'markets.id', 'events.market_id')
    .leftJoin('event_private', 'event_private.event_id', 'events.id')
    .selectAll('events')
    .select([
      'markets.city as market_city',
      'markets.tz as market_tz',
      'event_private.exact_address',
      latestReview('event', 'events.id'),
    ]);
}

export type OwnerEventRow = Awaited<ReturnType<ReturnType<typeof ownerEventQuery>['executeTakeFirstOrThrow']>>;

/** The owner's JSON. Delegates to the one event mapping, `serializeEvent`. */
export function toOwnerEventView(row: OwnerEventRow): PrivateEventView {
  return serializeEvent(row, 'owner', new Date());
}

export type OwnerEventView = PrivateEventView;
