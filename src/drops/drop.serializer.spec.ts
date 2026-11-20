import { type DropRow, serializeDrop } from './drop.serializer.js';

const now = new Date('2026-11-19T12:00:00Z');
const row = (over: Partial<DropRow> = {}): DropRow => ({
  id: 'd1',
  local_id: 'l1',
  market_id: 'new-york-city',
  title: 'Hand-pulled dumplings',
  why_now: 'Fresh batch before noon.',
  perfect_for: 'Food lovers',
  cost_min_usd: 5,
  cost_max_usd: 12,
  time_minutes: 45,
  best_time: null,
  watch_out: 'Cash only.',
  photo_media_id: 'm1',
  photo_is_stand_in: false,
  fuzzy_area: 'Lower East Side',
  unlock_price_minor: 200,
  unlock_cap: 8,
  window_hours: 24,
  status: 'live',
  approved_at: new Date('2026-11-19T10:00:00Z'),
  expires_at: new Date('2026-11-20T10:00:00Z'),
  unlocks_used: 0,
  window_date: null,
  created_at: new Date('2026-11-18T10:00:00Z'),
  updated_at: new Date('2026-11-18T11:00:00Z'),
  market_city: 'New York City',
  market_tz: 'America/New_York',
  local_display_name: 'Test Local',
  local_role_title: 'Cook',
  local_verified_at: new Date('2026-01-01T00:00:00Z'),
  exact_place: 'SECRET-PLACE-123',
  meet_detail: 'Back counter',
  ...over,
});

describe('serializeDrop', () => {
  it('public view has no private keys or values', () => {
    const v = serializeDrop(row(), 'public', now);
    const keys = Object.keys(v);
    expect(keys).not.toContain('exactPlace');
    expect(keys).not.toContain('meetDetail');
    expect(JSON.stringify(v)).not.toContain('SECRET-PLACE-123');
  });
  it('owner and reviewer views include exactPlace and meetDetail', () => {
    for (const a of ['owner', 'reviewer'] as const) {
      expect(serializeDrop(row(), a, now)).toMatchObject({ exactPlace: 'SECRET-PLACE-123', meetDetail: 'Back counter' });
    }
  });
  it('unlocksLeft equals unlocksPerDay when nothing is used, and never goes below zero', () => {
    expect(serializeDrop(row(), 'public', now).unlocksLeft).toBe(8);
    expect(serializeDrop(row({ unlocks_used: 3 }), 'public', now).unlocksLeft).toBe(5);
    expect(serializeDrop(row({ unlocks_used: 11 }), 'public', now).unlocksLeft).toBe(0);
  });
  it('maps price, local and market', () => {
    const v = serializeDrop(row(), 'public', now);
    expect(v.unlockPriceCredits).toBe(2);
    expect(v.local).toEqual({ id: 'l1', displayName: 'Test Local', roleTitle: 'Cook', verified: true });
    expect(v.market).toEqual({ id: 'new-york-city', city: 'New York City', tz: 'America/New_York' });
    expect(v.photo).toEqual({ mediaId: 'm1', isStandIn: false });
    expect(serializeDrop(row({ local_verified_at: null }), 'public', now).local.verified).toBe(false);
  });

  it('photo.url is filled only when a media base URL is given', () => {
    expect(serializeDrop(row(), 'public', now).photo).toEqual({ mediaId: 'm1', isStandIn: false });
    expect(serializeDrop(row(), 'public', now, { mediaBaseUrl: 'https://cdn.raahi.test' }).photo).toEqual({
      mediaId: 'm1',
      url: 'https://cdn.raahi.test/media/m1/display.jpg',
      isStandIn: false,
    });
    expect(serializeDrop(row(), 'owner', now, { mediaBaseUrl: 'https://cdn.raahi.test/' }).photo.url).toBe(
      'https://cdn.raahi.test/media/m1/display.jpg',
    );
  });
});
