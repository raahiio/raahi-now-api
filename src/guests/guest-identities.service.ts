import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { Clock } from '../common/clock.js';
import { hashKey } from '../common/device.js';
import { AppError } from '../common/errors/app-error.js';
import { RateLimiter } from '../common/rate-limit.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import type { Schema } from '../db/schema.js';
import { DB } from '../db/tokens.js';
import { Mailer } from '../mail/mailer.js';
import { generateClaimCode, hashClaimCode, normalizeClaimCode } from './claim-codes.js';
import { MANAGE_TOKEN_TTL_SECONDS, signManageToken } from './manage-token.js';

const HOUR_SECONDS = 3600;
const MAX_FAILURES_PER_HOUR = 5;
const RECOVER_PER_EMAIL = 3;
const RECOVER_PER_IP = 10;

/** Hashed caller keys. The device key is null when no usable X-Device-Id was sent. */
export interface CallerKeys {
  deviceHash: string | null;
  ipHash: string;
}

export interface ClaimedEvent {
  identityId: string;
  eventId: string;
}

@Injectable()
export class GuestIdentitiesService {
  private readonly logger = new Logger('Guests');

  constructor(
    @Inject(DB) private readonly db: Kysely<Schema>,
    @Inject(ENV) private readonly env: Env,
    private readonly limiter: RateLimiter,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
  ) {}

  /** A fresh code and the hash to store for it. */
  newCode(): { code: string; hash: string } {
    const code = generateClaimCode();
    return { code, hash: hashClaimCode(code, this.env.CLAIM_CODE_SECRET) };
  }

  /** 429 `claim.locked` once either key has 5 failures in the past hour. Runs before any code check. */
  async assertNotLocked(keys: CallerKeys): Promise<void> {
    const hashes = [keys.deviceHash, keys.ipHash].filter((h): h is string => h !== null);
    const rows = await this.db
      .selectFrom('rate_events')
      .select(['key_hash', sql<string>`count(*)`.as('n')])
      .where('kind', '=', 'claim_failure')
      .where('key_hash', 'in', hashes)
      .where(sql<boolean>`created_at > now() - make_interval(secs => ${HOUR_SECONDS})`)
      .groupBy('key_hash')
      .execute();
    if (rows.some((r) => Number(r.n) >= MAX_FAILURES_PER_HOUR)) throw new AppError(429, 'claim.locked');
  }

  async recordFailure(keys: CallerKeys): Promise<void> {
    const hashes = [keys.deviceHash, keys.ipHash].filter((h): h is string => h !== null);
    await this.db
      .insertInto('rate_events')
      .values(hashes.map((key_hash) => ({ kind: 'claim_failure', key_hash })))
      .execute();
  }

  /** The event a claim code opens, or null. Removed events never match. */
  async findByCode(rawCode: string): Promise<ClaimedEvent | null> {
    const hash = hashClaimCode(normalizeClaimCode(rawCode), this.env.CLAIM_CODE_SECRET);
    const row = await this.db
      .selectFrom('guest_identities')
      .innerJoin('events', 'events.guest_identity_id', 'guest_identities.id')
      .select(['guest_identities.id as identity_id', 'events.id as event_id'])
      .where('guest_identities.claim_hash', '=', hash)
      .where('events.status', '!=', 'removed')
      .executeTakeFirst();
    return row ? { identityId: row.identity_id, eventId: row.event_id } : null;
  }

  /** Does this code open this event? Failures are the caller's to record. */
  async codeOpensEvent(eventId: string, rawCode: string): Promise<ClaimedEvent | null> {
    const row = await this.db
      .selectFrom('events')
      .innerJoin('guest_identities', 'guest_identities.id', 'events.guest_identity_id')
      .select(['guest_identities.id as identity_id', 'guest_identities.claim_hash'])
      .where('events.id', '=', eventId)
      .executeTakeFirst();
    if (!row) return null;
    const given = Buffer.from(hashClaimCode(normalizeClaimCode(rawCode), this.env.CLAIM_CODE_SECRET), 'hex');
    const stored = Buffer.from(row.claim_hash, 'hex');
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) return null;
    return { identityId: row.identity_id, eventId };
  }

  async exchange(rawCode: string, keys: CallerKeys): Promise<{ manageToken: string; expiresIn: number }> {
    await this.assertNotLocked(keys);
    const found = typeof rawCode === 'string' ? await this.findByCode(rawCode) : null;
    if (!found) {
      await this.recordFailure(keys);
      throw new AppError(401, 'claim.invalid');
    }
    const manageToken = await signManageToken(
      { sub: found.identityId, evt: found.eventId },
      this.env.MANAGE_TOKEN_SECRET,
      this.clock.now(),
    );
    return { manageToken, expiresIn: MANAGE_TOKEN_TTL_SECONDS };
  }

  /**
   * Always resolves for a well-formed request, so an unknown email looks like a known one.
   * Rotates the code of every live event owned by that email and sends one email with all of them.
   */
  async recover(email: string, ip: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    await this.limiter.hit('claim_recover_email', hashKey(normalized, this.env.DEVICE_HASH_SALT), RECOVER_PER_EMAIL, HOUR_SECONDS);
    await this.limiter.hit('claim_recover_ip', hashKey(ip, this.env.DEVICE_HASH_SALT), RECOVER_PER_IP, HOUR_SECONDS);

    const issued = await this.db.transaction().execute(async (trx) => {
      const rows = await trx
        .selectFrom('guest_identities')
        .innerJoin('events', 'events.guest_identity_id', 'guest_identities.id')
        .select(['guest_identities.id as identity_id', 'events.name', 'events.created_at'])
        .where(sql<string>`lower(guest_identities.email)`, '=', normalized)
        .where('events.status', '!=', 'removed')
        .orderBy('events.created_at')
        .orderBy('events.id')
        .forUpdate('guest_identities')
        .execute();
      const out: { name: string; code: string }[] = [];
      for (const row of rows) {
        const next = this.newCode();
        await trx.updateTable('guest_identities').set({ claim_hash: next.hash }).where('id', '=', row.identity_id).execute();
        out.push({ name: row.name, code: next.code });
      }
      return out;
    });
    if (issued.length === 0) return;

    const lines = issued.map((e) => `${e.name}: ${e.code}`).join('\n');
    // Not awaited: the response must take the same time whether or not the email is known.
    void this.mailer
      .send({
        to: normalized,
        subject: 'Your Raahi event claim codes',
        text: `Here are your new claim codes. Older codes no longer work.\n\n${lines}\n\nUse a code to edit or cancel its event.`,
      })
      .catch((err: unknown) => this.logger.error(`recovery mail failed: ${err instanceof Error ? err.name : 'unknown'}`));
  }
}
