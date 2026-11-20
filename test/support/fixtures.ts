import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';
import type { Schema } from '../../src/db/schema.js';
import { fakeToken } from './fake-verifier.js';

export interface TestLocal {
  userId: string;
  localId: string;
  headers: { Authorization: string };
}

/** A user plus a verified `locals` row, and the auth header that resolves to them. */
export async function createLocal(
  db: Kysely<Schema>,
  uid: string,
  opts: { verified?: boolean } = {},
): Promise<TestLocal> {
  const email = `${uid}@example.com`;
  const userId = uuidv7();
  const localId = uuidv7();
  await db
    .insertInto('users')
    .values({ id: userId, firebase_uid: uid, email, first_name: 'Local', tz: 'America/New_York' })
    .execute();
  await db
    .insertInto('locals')
    .values({
      id: localId,
      user_id: userId,
      display_name: 'Test Local',
      role_title: 'Cook',
      bio: 'A bio that is long enough.',
      booking_label: null,
      booking_price_minor: null,
      verified_at: opts.verified === false ? null : new Date(),
    })
    .execute();
  return { userId, localId, headers: { Authorization: fakeToken({ uid, email }) } };
}

/** A media row owned by the user; `ready` unless told otherwise. */
export async function createMedia(
  db: Kysely<Schema>,
  ownerUserId: string,
  status: 'pending' | 'ready' = 'ready',
): Promise<string> {
  const id = uuidv7();
  await db
    .insertInto('media')
    .values({
      id,
      owner_user_id: ownerUserId,
      content_type: 'image/jpeg',
      s3_key: `media/${id}/display.jpg`,
      width: status === 'ready' ? 1200 : null,
      height: status === 'ready' ? 800 : null,
      status,
    })
    .execute();
  return id;
}

export interface InsertEventOptions {
  marketId?: string;
  status?: 'pending' | 'upcoming' | 'past' | 'cancelled' | 'rejected' | 'removed';
  name?: string;
  /** Registered user who owns the event. Omit to make a guest event. */
  ownerUserId?: string;
  /** Guest host email, used when there is no owner. */
  guestEmail?: string;
  exactAddress?: string | null;
  startsAt?: Date;
  /** Adds a pending review item with this submitted_at. */
  review?: { submittedAt?: Date } | false;
}

/**
 * Inserts an event row directly (the event API arrives in a later task), plus its private
 * address and a pending review item by default. Returns the event id.
 */
export async function insertEvent(db: Kysely<Schema>, opts: InsertEventOptions = {}): Promise<string> {
  const id = uuidv7();
  let guestIdentityId: string | null = null;
  if (!opts.ownerUserId) {
    guestIdentityId = uuidv7();
    await db
      .insertInto('guest_identities')
      .values({ id: guestIdentityId, email: opts.guestEmail ?? `guest-${id}@example.com`, claim_hash: `hash-${id}` })
      .execute();
  }
  const status = opts.status ?? 'pending';
  await db
    .insertInto('events')
    .values({
      id,
      owner_user_id: opts.ownerUserId ?? null,
      guest_identity_id: guestIdentityId,
      market_id: opts.marketId ?? 'new-york-city',
      name: opts.name ?? 'Saturday dumpling walk',
      category: 'walk',
      description: 'A relaxed walk through the neighborhood, tasting as we go.',
      starts_at: opts.startsAt ?? new Date(Date.now() + 3 * 24 * 3_600_000),
      area: 'Lower East Side',
      address_visibility: opts.exactAddress === null ? null : 'after_rsvp',
      host_name: 'Host Person',
      host_badge: opts.ownerUserId ? 'verified_local' : 'community_host',
      status,
    })
    .execute();
  if (opts.exactAddress !== null) {
    await db
      .insertInto('event_private')
      .values({ event_id: id, exact_address: opts.exactAddress ?? '14 Eldridge Street' })
      .execute();
  }
  if (opts.review !== false && status === 'pending') {
    await db
      .insertInto('review_items')
      .values({ id: uuidv7(), kind: 'event', ref_id: id, state: 'pending', submitted_at: opts.review?.submittedAt ?? new Date() })
      .execute();
  }
  return id;
}
