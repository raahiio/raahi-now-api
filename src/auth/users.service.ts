import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import { uuidv7 } from 'uuidv7';
import { DB } from '../db/tokens.js';
import type { Schema, UsersTable } from '../db/schema.js';
import type { CurrentUser } from './current-user.decorator.js';
import type { VerifiedToken } from './id-token-verifier.js';
import type { Role } from './roles.decorator.js';

export type UserRow = Selectable<UsersTable>;
export interface UserWithLocal {
  user: UserRow;
  local: { id: string; verified_at: Date | null } | null;
}

const CLAIM_ROLES: readonly string[] = ['reviewer', 'admin'];

function defaultFirstName(token: VerifiedToken): string {
  const fromName = token.name?.trim().split(/\s+/)[0];
  const raw = fromName || token.email.split('@')[0] || 'Traveler';
  return Array.from(raw).slice(0, 60).join('');
}

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Kysely<Schema>) {}

  /** Upserts by firebase_uid (safe under concurrent first requests) and returns the user plus its locals row. */
  async findOrCreate(token: VerifiedToken): Promise<UserWithLocal> {
    const user = await this.db
      .insertInto('users')
      .values({
        id: uuidv7(),
        firebase_uid: token.uid,
        email: token.email,
        first_name: defaultFirstName(token),
        email_verified: token.emailVerified,
        tz: 'UTC',
      })
      .onConflict((oc) =>
        oc.column('firebase_uid').doUpdateSet((eb) => ({
          email: eb.ref('excluded.email'),
          email_verified: eb.ref('excluded.email_verified'),
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return { user, local: await this.localFor(user.id) };
  }

  private async localFor(userId: string): Promise<UserWithLocal['local']> {
    const local = await this.db
      .selectFrom('locals')
      .select(['id', 'verified_at'])
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return local ?? null;
  }

  async getWithLocal(userId: string): Promise<UserWithLocal> {
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    return { user, local: await this.localFor(userId) };
  }

  async resolveCurrentUser(token: VerifiedToken): Promise<CurrentUser> {
    const { user, local } = await this.findOrCreate(token);
    const roles: Role[] = token.roles.filter((r): r is Role =>
      CLAIM_ROLES.includes(r),
    );
    if (local?.verified_at) roles.push('local');
    return {
      id: user.id,
      firebaseUid: user.firebase_uid,
      email: user.email,
      emailVerified: user.email_verified,
      roles,
      localId: local?.id ?? null,
      tz: user.tz,
    };
  }

  /** Applies a profile patch. A socials value of null or '' removes that handle. */
  async updateProfile(
    userId: string,
    patch: {
      firstName?: string;
      tz?: string;
      socials?: Record<string, string | null>;
    },
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('users')
        .select('socials')
        .where('id', '=', userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const set: { first_name?: string; tz?: string; socials?: string } = {};
      if (patch.firstName !== undefined) set.first_name = patch.firstName;
      if (patch.tz !== undefined) set.tz = patch.tz;
      if (patch.socials !== undefined) {
        const merged: Record<string, string> = {
          ...(current.socials as Record<string, string>),
        };
        for (const [platform, handle] of Object.entries(patch.socials)) {
          if (handle === null || handle === '') delete merged[platform];
          else if (handle !== undefined) merged[platform] = handle;
        }
        set.socials = JSON.stringify(merged);
      }
      if (Object.keys(set).length > 0)
        await trx
          .updateTable('users')
          .set(set)
          .where('id', '=', userId)
          .execute();
    });
  }
}
