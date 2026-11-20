import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';
import type { Schema } from '../src/db/schema.js';
import { DropSweeper } from '../src/jobs/drop-sweeper.service.js';
import { EventSweeper } from '../src/jobs/event-sweeper.service.js';
import { withAdvisoryLock } from '../src/jobs/advisory-lock.js';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { closeTestDbs, getTestDb, resetDb } from './support/db.js';
import { createLocal, createMedia, insertEvent, type TestLocal } from './support/fixtures.js';

const NOW = new Date('2026-12-01T12:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe('Outbox relay and sweepers (e2e)', () => {
  let t: TestApp;
  let db: Kysely<Schema>;
  let me: TestLocal;
  let mediaId: string;
  let drops: DropSweeper;
  let events: EventSweeper;
  let relay: OutboxRelayService;

  beforeAll(async () => {
    db = getTestDb();
    t = await createTestApp();
    drops = t.app.get(DropSweeper);
    events = t.app.get(EventSweeper);
    relay = t.app.get(OutboxRelayService);
  });
  afterAll(async () => {
    await t.app.close();
    await closeTestDbs();
  });
  beforeEach(async () => {
    await resetDb(db);
    t.publisher.clear();
    me = await createLocal(db, 'local1');
    mediaId = await createMedia(db, me.userId);
  });

  async function insertDrop(status: 'live' | 'paused' | 'pending' | 'gone', expiresAt: Date | null): Promise<string> {
    const id = uuidv7();
    await db
      .insertInto('drops')
      .values({
        id,
        local_id: me.localId,
        market_id: 'new-york-city',
        title: 'Best dumplings',
        why_now: 'Fresh batch',
        perfect_for: 'Everyone',
        cost_min_usd: 5,
        cost_max_usd: 10,
        time_minutes: 30,
        watch_out: 'Cash only',
        photo_media_id: mediaId,
        fuzzy_area: 'Lower East Side',
        unlock_price_minor: 100,
        unlock_cap: 5,
        window_hours: 3,
        status,
        expires_at: expiresAt,
      })
      .execute();
    return id;
  }

  async function insertUpcoming(startsAt: Date, endsAt: Date | null): Promise<string> {
    const id = await insertEvent(db, { status: 'upcoming', startsAt });
    await db.updateTable('events').set({ ends_at: endsAt }).where('id', '=', id).execute();
    return id;
  }

  const outboxRows = () => db.selectFrom('outbox').selectAll().orderBy('created_at').orderBy('id').execute();
  const statusOf = async (table: 'drops' | 'events', id: string) =>
    (await db.selectFrom(table).select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;

  it('DropSweeper marks expired live and paused Drops gone and writes drop.ended once', async () => {
    const a = await insertDrop('live', minutes(-1));
    const b = await insertDrop('paused', minutes(0));
    const pending = await insertDrop('pending', minutes(-60));
    expect(await drops.run(NOW)).toBe(2);
    expect(await drops.run(NOW)).toBe(0);
    expect(await statusOf('drops', a)).toBe('gone');
    expect(await statusOf('drops', b)).toBe('gone');
    expect(await statusOf('drops', pending)).toBe('pending');
    const rows = await outboxRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.subject_id).sort((p, q) => p.localeCompare(q))).toEqual([a, b].sort((p, q) => p.localeCompare(q)));
    for (const r of rows) {
      expect(r.type).toBe('drop.ended');
      expect(r.subject_kind).toBe('drop');
      expect(r.payload).toEqual({ actorId: null, data: { reason: 'expired' } });
    }
  });

  it('DropSweeper leaves a live Drop whose expires_at is in the future', async () => {
    const id = await insertDrop('live', minutes(1));
    expect(await drops.run(NOW)).toBe(0);
    expect(await statusOf('drops', id)).toBe('live');
    expect(await outboxRows()).toHaveLength(0);
  });

  it('EventSweeper marks an upcoming event past 3 hours after its end, or after its start when it has no end', async () => {
    const withEnd = await insertUpcoming(minutes(-600), minutes(-180));
    const noEnd = await insertUpcoming(minutes(-180), null);
    expect(await events.run(NOW)).toBe(2);
    expect(await events.run(NOW)).toBe(0);
    expect(await statusOf('events', withEnd)).toBe('past');
    expect(await statusOf('events', noEnd)).toBe('past');
    const rows = await outboxRows();
    expect(rows.map((r) => r.type)).toEqual(['event.ended', 'event.ended']);
    expect(rows.map((r) => r.subject_id).sort((p, q) => p.localeCompare(q))).toEqual([withEnd, noEnd].sort((p, q) => p.localeCompare(q)));
  });

  it('EventSweeper leaves an event 2h59m after its end', async () => {
    const id = await insertUpcoming(minutes(-600), minutes(-179));
    expect(await events.run(NOW)).toBe(0);
    expect(await statusOf('events', id)).toBe('upcoming');
  });

  it('the relay publishes unpublished rows in order per subject and sets published_at', async () => {
    const a = await insertDrop('live', minutes(-1));
    const b = await insertDrop('live', minutes(-1));
    await drops.run(NOW);
    const ev = await insertUpcoming(minutes(-600), minutes(-200));
    await events.run(NOW);
    const expected = (await outboxRows()).map((r) => r.id);
    expect(await relay.run()).toBe(3);
    expect(t.publisher.published.map((e) => e.id)).toEqual(expected);
    expect(t.publisher.published.map((e) => e.subject.id).sort((p, q) => p.localeCompare(q))).toEqual([a, b, ev].sort((p, q) => p.localeCompare(q)));
    expect((await outboxRows()).every((r) => r.published_at !== null)).toBe(true);
    expect(await relay.run()).toBe(0);
  });

  it('a publish failure leaves the row unpublished, and the next run retries it', async () => {
    const a = await insertDrop('live', minutes(-1));
    const b = await insertDrop('live', minutes(-1));
    await drops.run(NOW);
    t.publisher.failFor({ subjectId: a });
    expect(await relay.run()).toBe(1);
    expect(t.publisher.published.map((e) => e.subject.id)).toEqual([b]);
    const pending = await db.selectFrom('outbox').selectAll().where('published_at', 'is', null).execute();
    expect(pending.map((r) => r.subject_id)).toEqual([a]);
    t.publisher.clearFailures();
    expect(await relay.run()).toBe(1);
    expect(t.publisher.published.map((e) => e.subject.id)).toEqual([b, a]);
  });

  it('a failure stops later rows of the same subject but not other subjects', async () => {
    const a = uuidv7();
    const b = uuidv7();
    const mk = (subjectId: string, type: string) =>
      db
        .insertInto('outbox')
        .values({ id: uuidv7(), type, subject_kind: 'drop', subject_id: subjectId, payload: JSON.stringify({ actorId: null, data: {} }) })
        .returningAll()
        .executeTakeFirstOrThrow();
    const a1 = await mk(a, 'drop.approved');
    await mk(a, 'drop.paused');
    await mk(b, 'drop.approved');
    t.publisher.failFor({ id: a1.id });
    expect(await relay.run()).toBe(1);
    expect(t.publisher.published.map((e) => e.subject.id)).toEqual([b]);
  });

  it('withAdvisoryLock lets one of two concurrent runs execute', async () => {
    const slow = () => new Promise<string>((resolve) => setTimeout(() => resolve('done'), 300));
    const [x, y] = await Promise.all([withAdvisoryLock(db, 99_001, slow), withAdvisoryLock(db, 99_001, slow)]);
    expect([x.ran, y.ran].sort((p, q) => Number(p) - Number(q))).toEqual([false, true]);
    const again = await withAdvisoryLock(db, 99_001, slow);
    expect(again).toEqual({ ran: true, value: 'done' });
  });

  it('withAdvisoryLock releases the lock when fn throws', async () => {
    await expect(withAdvisoryLock(db, 99_002, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect((await withAdvisoryLock(db, 99_002, async () => 1)).ran).toBe(true);
  });

  it('the envelope matches { id, type, v: 1, occurredAt, actor, subject, data }', async () => {
    const id = await insertDrop('live', minutes(-1));
    await drops.run(NOW);
    const [row] = await outboxRows();
    await relay.run();
    expect(t.publisher.published).toEqual([
      {
        id: row!.id,
        type: 'drop.ended',
        v: 1,
        occurredAt: row!.created_at.toISOString(),
        actor: { id: null },
        subject: { kind: 'drop', id },
        data: { reason: 'expired' },
      },
    ]);
  });
});
