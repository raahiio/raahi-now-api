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
