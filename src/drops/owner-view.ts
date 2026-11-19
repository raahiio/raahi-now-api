import type { Kysely, Transaction } from 'kysely';
import type { Schema } from '../db/schema.js';
import { type DropRow, type PrivateDropView, serializeDrop } from './drop.serializer.js';

/** Drops joined with their private fields, market and local, for owner and reviewer views. */
export function ownerDropQuery(db: Kysely<Schema> | Transaction<Schema>) {
  return db
    .selectFrom('drops')
    .innerJoin('drop_private', 'drop_private.drop_id', 'drops.id')
    .innerJoin('markets', 'markets.id', 'drops.market_id')
    .innerJoin('locals', 'locals.id', 'drops.local_id')
    .selectAll('drops')
    .select([
      'drop_private.exact_place',
      'drop_private.meet_detail',
      'markets.city as market_city',
      'markets.tz as market_tz',
      'locals.display_name as local_display_name',
      'locals.role_title as local_role_title',
      'locals.verified_at as local_verified_at',
    ]);
}

export type OwnerDropView = PrivateDropView;

/** The owner's view of a Drop. Thin wrapper over the one serializer. */
export function toOwnerView(r: DropRow, now: Date = new Date()): OwnerDropView {
  return serializeDrop(r, 'owner', now);
}
