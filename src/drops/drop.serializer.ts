import type { Selectable } from 'kysely';
import type { DropsTable } from '../db/schema.js';
import { displayUrl, type SerializeOptions } from '../media/media-url.js';
import type { ReviewSummary } from '../review/review-summary.js';

export type Audience = 'public' | 'owner' | 'reviewer';

/** A drops row joined with its market and local, plus the private fields for owner and reviewer reads. */
export type DropRow = Selectable<DropsTable> & {
  market_city: string;
  market_tz: string;
  local_display_name: string;
  local_role_title: string;
  local_verified_at: Date | null;
  exact_place?: string;
  meet_detail?: string | null;
  /** Latest review decision; only owner and reviewer queries select it. */
  review?: ReviewSummary | null;
};

export interface PublicDropView {
  id: string;
  title: string;
  whyNow: string;
  perfectFor: string;
  cost: { minUsd: number; maxUsd: number };
  timeMinutes: number;
  bestTime: string | null;
  watchOut: string;
  photo: { mediaId: string; url?: string; isStandIn: boolean };
  market: { id: string; city: string; tz: string };
  fuzzyArea: string;
  unlockPriceCredits: number;
  unlocksPerDay: number;
  unlocksLeft: number;
  status: string;
  expiresAt: string | null;
  local: { id: string; displayName: string; roleTitle: string; verified: boolean };
}

export interface PrivateDropView extends PublicDropView {
  windowHours: number;
  exactPlace: string;
  meetDetail: string | null;
  review: ReviewSummary | null;
  createdAt: string;
  updatedAt: string;
}

export type DropView = PublicDropView | PrivateDropView;

/** The only mapping from a Drop row to a response. The public view never carries private keys. */
export function serializeDrop(row: DropRow, audience: 'public', now: Date, opts?: SerializeOptions): PublicDropView;
export function serializeDrop(
  row: DropRow,
  audience: 'owner' | 'reviewer',
  now: Date,
  opts?: SerializeOptions,
): PrivateDropView;
export function serializeDrop(row: DropRow, audience: Audience, now: Date, opts?: SerializeOptions): DropView;
export function serializeDrop(row: DropRow, audience: Audience, _now: Date, opts: SerializeOptions = {}): DropView {
  const url = displayUrl(row.photo_media_id, opts.mediaBaseUrl);
  const view: PublicDropView = {
    id: row.id,
    title: row.title,
    whyNow: row.why_now,
    perfectFor: row.perfect_for,
    cost: { minUsd: row.cost_min_usd, maxUsd: row.cost_max_usd },
    timeMinutes: row.time_minutes,
    bestTime: row.best_time,
    watchOut: row.watch_out,
    photo: { mediaId: row.photo_media_id, ...(url ? { url } : {}), isStandIn: row.photo_is_stand_in },
    market: { id: row.market_id, city: row.market_city, tz: row.market_tz },
    fuzzyArea: row.fuzzy_area,
    unlockPriceCredits: row.unlock_price_minor / 100,
    unlocksPerDay: row.unlock_cap,
    unlocksLeft: Math.max(0, row.unlock_cap - row.unlocks_used),
    status: row.status,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    local: {
      id: row.local_id,
      displayName: row.local_display_name,
      roleTitle: row.local_role_title,
      verified: row.local_verified_at != null,
    },
  };
  if (audience === 'public') return view;
  return {
    ...view,
    windowHours: row.window_hours,
    exactPlace: row.exact_place as string,
    meetDetail: row.meet_detail ?? null,
    review: row.review ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
