import type { Selectable } from 'kysely';
import { formatInZone } from '../common/time/wall-clock.js';
import type { EventsTable } from '../db/schema.js';
import type { Audience } from '../drops/drop.serializer.js';

type PublicColumns =
  | 'id'
  | 'market_id'
  | 'name'
  | 'category'
  | 'description'
  | 'starts_at'
  | 'ends_at'
  | 'date_note'
  | 'area'
  | 'address_visibility'
  | 'photo_media_id'
  | 'link'
  | 'capacity'
  | 'host_name'
  | 'host_badge'
  | 'status'
  | 'created_at'
  | 'updated_at';

/**
 * An events row joined with its market, plus the private address when the caller was allowed to
 * read it. Never carries owner_user_id or guest_identity_id, so the public role can build it.
 */
export type EventRow = Pick<Selectable<EventsTable>, PublicColumns> & {
  market_city: string;
  market_tz: string;
  exact_address?: string | null;
};

export interface PublicEventView {
  id: string;
  name: string;
  category: string;
  market: { id: string; city: string; tz: string };
  description: string;
  startsAt: string;
  startsAtLocal: string;
  endsAt: string | null;
  endsAtLocal: string | null;
  dateNote: string | null;
  area: string;
  /** Capacity, or null when the host set none. RSVPs arrive in a later phase. */
  spotsLeft: number | null;
  link: string | null;
  photo: { mediaId: string } | null;
  host: { name: string; badge: string };
  /** Only when the address visibility is `public`. */
  exactAddress?: string;
}

export interface PrivateEventView extends Omit<PublicEventView, 'exactAddress'> {
  exactAddress: string | null;
  addressVisibility: string | null;
  capacity: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export type EventView = PublicEventView | PrivateEventView;

/**
 * The only mapping from an event row to a response. The public view carries `exactAddress` only
 * when the event's visibility is `public`; owner and reviewer always see the stored address.
 * `now` is accepted for parity with `serializeDrop`; nothing in the view is time-relative yet.
 */
export function serializeEvent(row: EventRow, audience: 'public', now: Date): PublicEventView;
export function serializeEvent(row: EventRow, audience: 'owner' | 'reviewer', now: Date): PrivateEventView;
export function serializeEvent(row: EventRow, audience: Audience, now: Date): EventView;
export function serializeEvent(row: EventRow, audience: Audience, _now: Date): EventView {
  const local = (d: Date) => formatInZone(d, row.market_tz).iso;
  const base: PublicEventView = {
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
    spotsLeft: row.capacity,
    link: row.link,
    photo: row.photo_media_id ? { mediaId: row.photo_media_id } : null,
    host: { name: row.host_name, badge: row.host_badge },
  };

  if (audience === 'public') {
    if (row.address_visibility === 'public' && row.exact_address) base.exactAddress = row.exact_address;
    return base;
  }

  const { exactAddress: _omit, ...rest } = base;
  return {
    ...rest,
    exactAddress: row.exact_address ?? null,
    addressVisibility: row.address_visibility,
    capacity: row.capacity,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
