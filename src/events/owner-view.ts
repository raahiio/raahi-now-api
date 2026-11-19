import type { Kysely, Transaction } from 'kysely';
import { formatInZone } from '../common/time/wall-clock.js';
import type { Schema } from '../db/schema.js';

type Executor = Kysely<Schema> | Transaction<Schema>;

/** Events joined with their market zone and private address: everything the owner view needs. */
export function ownerEventQuery(db: Executor) {
  return db
    .selectFrom('events')
    .innerJoin('markets', 'markets.id', 'events.market_id')
    .leftJoin('event_private', 'event_private.event_id', 'events.id')
    .selectAll('events')
    .select(['markets.city as market_city', 'markets.tz as market_tz', 'event_private.exact_address']);
}

export type OwnerEventRow = Awaited<ReturnType<ReturnType<typeof ownerEventQuery>['executeTakeFirstOrThrow']>>;

/** The single mapping from an event row to the owner's JSON. Task 14 builds `serializeEvent` around it. */
export function toOwnerEventView(row: OwnerEventRow) {
  const local = (d: Date) => formatInZone(d, row.market_tz).iso;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    market: { id: row.market_id, city: row.market_city, tz: row.market_tz },
    description: row.description,
    startsAt: row.starts_at.toISOString(),
    startsAtLocal: local(row.starts_at),
    endsAt: row.ends_at ? row.ends_at.toISOString() : null,
    endsAtLocal: row.ends_at ? local(row.ends_at) : null,
    dateNote: row.date_note,
    area: row.area,
    exactAddress: row.exact_address ?? null,
    addressVisibility: row.address_visibility,
    capacity: row.capacity,
    photo: row.photo_media_id ? { mediaId: row.photo_media_id } : null,
    link: row.link,
    host: { name: row.host_name, badge: row.host_badge },
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export type OwnerEventView = ReturnType<typeof toOwnerEventView>;
