import { type EventRow, serializeEvent } from './event.serializer.js';

const row = (o: Partial<EventRow> = {}): EventRow => ({
  id: '0192a000-0000-7000-8000-000000000001',
  market_id: 'boston',
  market_city: 'Boston',
  market_tz: 'America/New_York',
  name: 'Saturday dumpling walk',
  category: 'walk',
  description: 'A relaxed walk through the neighborhood, tasting as we go.',
  starts_at: new Date('2026-11-14T19:00:00Z'),
  ends_at: null,
  date_note: null,
  area: 'Chinatown',
  address_visibility: 'after_rsvp',
  photo_media_id: null,
  link: null,
  capacity: null,
  host_name: 'Host Person',
  host_badge: 'community_host',
  status: 'upcoming',
  created_at: new Date('2026-11-01T00:00:00Z'),
  updated_at: new Date('2026-11-01T00:00:00Z'),
  exact_address: 'SECRET-ADDR-456',
  ...o,
});
const now = new Date('2026-11-10T00:00:00Z');

describe('serializeEvent', () => {
  it('startsAtLocal carries the market offset', () => {
    expect(serializeEvent(row(), 'public', now).startsAtLocal).toBe('2026-11-14T14:00:00-05:00');
  });

  it('spotsLeft is the capacity, or null', () => {
    expect(serializeEvent(row({ capacity: 12 }), 'public', now).spotsLeft).toBe(12);
    expect(serializeEvent(row(), 'public', now).spotsLeft).toBeNull();
  });

  it('maps photo and host', () => {
    const v = serializeEvent(row({ photo_media_id: 'm1' }), 'public', now);
    expect(v.photo).toEqual({ mediaId: 'm1' });
    expect(v.host).toEqual({ name: 'Host Person', badge: 'community_host' });
  });

  it('the public view shows the address only when visibility is public', () => {
    expect(serializeEvent(row({ address_visibility: 'public' }), 'public', now).exactAddress).toBe('SECRET-ADDR-456');
    const hidden = serializeEvent(row(), 'public', now);
    expect(hidden).not.toHaveProperty('exactAddress');
    expect(JSON.stringify(hidden)).not.toContain('SECRET-ADDR-456');
    expect(serializeEvent(row({ address_visibility: null }), 'public', now)).not.toHaveProperty('exactAddress');
  });

  it('the public view carries no owner-only fields', () => {
    const v = serializeEvent(row({ address_visibility: 'public' }), 'public', now);
    for (const k of ['addressVisibility', 'capacity', 'status', 'createdAt', 'updatedAt', 'hostEmail']) expect(v).not.toHaveProperty(k);
  });

  it('owner and reviewer always see the stored address and the private fields', () => {
    for (const a of ['owner', 'reviewer'] as const) {
      expect(serializeEvent(row(), a, now)).toMatchObject({
        exactAddress: 'SECRET-ADDR-456',
        addressVisibility: 'after_rsvp',
        capacity: null,
        status: 'upcoming',
      });
    }
    expect(serializeEvent(row({ exact_address: null }), 'owner', now).exactAddress).toBeNull();
  });

  it('photo.url is filled only when a media base URL is given', () => {
    const opts = { mediaBaseUrl: 'https://cdn.raahi.test' };
    expect(serializeEvent(row({ photo_media_id: 'm1' }), 'public', now).photo).toEqual({ mediaId: 'm1' });
    expect(serializeEvent(row({ photo_media_id: 'm1' }), 'public', now, opts).photo).toEqual({
      mediaId: 'm1',
      url: 'https://cdn.raahi.test/media/m1/display.jpg',
    });
    expect(serializeEvent(row({ photo_media_id: 'm1' }), 'owner', now, opts).photo?.url).toBe(
      'https://cdn.raahi.test/media/m1/display.jpg',
    );
    expect(serializeEvent(row(), 'public', now, opts).photo).toBeNull();
  });
});
