import { AppError } from '../common/errors/app-error.js';
import type { DropStatus } from '../db/schema.js';

export type { DropStatus };
export type DropAction =
  | 'submit'
  | 'pause'
  | 'resume'
  | 'end'
  | 'approve'
  | 'reject'
  | 'remove'
  | 'edit_text'
  | 'edit'
  | 'expire';

export const WINDOW_HOURS = [3, 6, 12, 24, 48, 72] as const;

/** Spec §5 state table. Anything not listed is 409 `drop.invalid_transition`. */
const TRANSITIONS: Record<DropStatus, Partial<Record<DropAction, DropStatus>>> = {
  draft: { submit: 'pending', edit: 'draft' },
  pending: { approve: 'live', reject: 'rejected', remove: 'removed' },
  live: { pause: 'paused', end: 'gone', expire: 'gone', edit_text: 'pending', remove: 'removed' },
  paused: { resume: 'live', end: 'gone', expire: 'gone', edit_text: 'pending', remove: 'removed' },
  gone: { remove: 'removed' },
  rejected: { edit: 'draft', remove: 'removed' },
  removed: {},
};

export function nextDropStatus(current: DropStatus, action: DropAction): DropStatus {
  const next = TRANSITIONS[current]?.[action];
  if (!next) throw new AppError(409, 'drop.invalid_transition');
  return next;
}
