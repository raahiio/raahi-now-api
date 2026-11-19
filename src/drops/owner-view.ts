import type { Kysely, Selectable, Transaction } from 'kysely';
import type { DropPrivateTable, DropsTable, Schema } from '../db/schema.js';

type OwnerRow = Selectable<DropsTable> &
  Pick<Selectable<DropPrivateTable>, 'exact_place' | 'meet_detail'> & { market_city: string; market_tz: string };

/** Drops joined with their private fields and market, for owner and reviewer views. */
export function ownerDropQuery(db: Kysely<Schema> | Transaction<Schema>) {
  return db
    .selectFrom('drops')
    .innerJoin('drop_private', 'drop_private.drop_id', 'drops.id')
    .innerJoin('markets', 'markets.id', 'drops.market_id')
    .selectAll('drops')
    .select(['drop_private.exact_place', 'drop_private.meet_detail', 'markets.city as market_city', 'markets.tz as market_tz']);
}

/** The owner's view of a Drop, with the private fields. (Task 11 moves this into serializeDrop.) */
export function toOwnerView(r: OwnerRow) {
  return {
    id: r.id,
    title: r.title,
    whyNow: r.why_now,
    perfectFor: r.perfect_for,
    cost: { minUsd: r.cost_min_usd, maxUsd: r.cost_max_usd },
    timeMinutes: r.time_minutes,
    bestTime: r.best_time,
    watchOut: r.watch_out,
    photo: { mediaId: r.photo_media_id, isStandIn: r.photo_is_stand_in },
    market: { id: r.market_id, city: r.market_city, tz: r.market_tz },
    fuzzyArea: r.fuzzy_area,
    unlockPriceCredits: r.unlock_price_minor / 100,
    unlocksPerDay: r.unlock_cap,
    unlocksLeft: Math.max(r.unlock_cap - r.unlocks_used, 0),
    status: r.status,
    expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
    windowHours: r.window_hours,
    exactPlace: r.exact_place,
    meetDetail: r.meet_detail,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export type OwnerDropView = ReturnType<typeof toOwnerView>;

