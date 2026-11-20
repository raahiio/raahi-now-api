import type { EventStatus } from '../db/schema.js';

export type { EventStatus };

export const EVENT_CATEGORIES = ['tasting', 'walk', 'market', 'class', 'gathering'] as const;
export const ADDRESS_VISIBILITIES = ['public', 'after_rsvp'] as const;

/** Statuses in which the host may still edit or cancel. */
export const EDITABLE_STATUSES: readonly EventStatus[] = ['pending', 'upcoming'];

export function hostBadge(hasVerifiedLocal: boolean): 'verified_local' | 'community_host' {
  return hasVerifiedLocal ? 'verified_local' : 'community_host';
}
