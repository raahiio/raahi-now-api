import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type TimestampNullable = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;

export type MarketStatus = 'preview' | 'open';
export type MediaStatus = 'pending' | 'ready' | 'rejected';
export type DropStatus =
  'draft' | 'pending' | 'live' | 'paused' | 'gone' | 'rejected' | 'removed';
export type EventStatus =
  'pending' | 'upcoming' | 'past' | 'cancelled' | 'rejected' | 'removed';
export type EventCategory =
  'tasting' | 'walk' | 'market' | 'class' | 'gathering';
export type AddressVisibility = 'public' | 'after_rsvp';
export type HostBadge = 'verified_local' | 'community_host';
export type ReviewKind = 'drop' | 'event';
export type ReviewState = 'pending' | 'approved' | 'rejected' | 'removed';

export interface UsersTable {
  id: string;
  firebase_uid: string;
  email: string;
  first_name: string;
  email_verified: Generated<boolean>;
  tz: string;
  socials: ColumnType<unknown, string | undefined, string>;
  created_at: Generated<Date>;
}

export interface LocalsTable {
  id: string;
  user_id: string;
  display_name: string;
  role_title: string;
  bio: string;
  booking_label: string | null;
  booking_price_minor: number | null;
  verified_at: TimestampNullable;
  created_at: Generated<Date>;
}

export interface MarketsTable {
  id: string;
  city: string;
  country: string;
  tz: string;
  reset_time: string;
  currency: string;
  status: MarketStatus;
}

export interface MediaTable {
  id: string;
  owner_user_id: string | null;
  owner_device_hash: string | null;
  content_type: string;
  s3_key: string;
  width: number | null;
  height: number | null;
  status: MediaStatus;
  reject_code: string | null;
  created_at: Generated<Date>;
}

export interface DropsTable {
  id: string;
  local_id: string;
  market_id: string;
  title: string;
  why_now: string;
  perfect_for: string;
  cost_min_usd: number;
  cost_max_usd: number;
  time_minutes: number;
  best_time: string | null;
  watch_out: string;
  photo_media_id: string;
  photo_is_stand_in: Generated<boolean>;
  fuzzy_area: string;
  unlock_price_minor: number;
  unlock_cap: number;
  window_hours: number;
  status: DropStatus;
  approved_at: TimestampNullable;
  expires_at: TimestampNullable;
  unlocks_used: Generated<number>;
  window_date: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DropPrivateTable {
  drop_id: string;
  exact_place: string;
  meet_detail: string | null;
}

export interface EventsTable {
  id: string;
  owner_user_id: string | null;
  guest_identity_id: string | null;
  market_id: string;
  name: string;
  category: EventCategory;
  description: string;
  starts_at: Timestamp;
  ends_at: TimestampNullable;
  date_note: string | null;
  area: string;
  address_visibility: AddressVisibility | null;
  photo_media_id: string | null;
  link: string | null;
  capacity: number | null;
  host_name: string;
  host_badge: HostBadge;
  status: EventStatus;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EventPrivateTable {
  event_id: string;
  exact_address: string;
}

export interface GuestIdentitiesTable {
  id: string;
  email: string;
  claim_hash: string;
  created_at: Generated<Date>;
}

export interface ReviewItemsTable {
  id: string;
  kind: ReviewKind;
  ref_id: string;
  state: Generated<ReviewState>;
  reason: string | null;
  flags: Generated<string[]>;
  submitted_at: Generated<Date>;
  decided_at: TimestampNullable;
  reviewer_id: string | null;
}

export interface OutboxTable {
  id: string;
  type: string;
  subject_kind: string;
  subject_id: string;
  payload: ColumnType<unknown, string | undefined, string>;
  created_at: Generated<Date>;
  published_at: TimestampNullable;
}

export interface RateEventsTable {
  id: Generated<string>;
  kind: string;
  key_hash: string;
  created_at: Generated<Date>;
}

export interface AuditLogTable {
  id: string;
  actor_id: string | null;
  action: string;
  target_kind: string;
  target_id: string;
  diff: ColumnType<unknown, string | undefined, string>;
  created_at: Generated<Date>;
}

export interface Schema {
  users: UsersTable;
  locals: LocalsTable;
  markets: MarketsTable;
  media: MediaTable;
  drops: DropsTable;
  drop_private: DropPrivateTable;
  events: EventsTable;
  event_private: EventPrivateTable;
  guest_identities: GuestIdentitiesTable;
  review_items: ReviewItemsTable;
  outbox: OutboxTable;
  rate_events: RateEventsTable;
  audit_log: AuditLogTable;
}
