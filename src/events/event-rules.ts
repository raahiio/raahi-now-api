import { AppError } from '../common/errors/app-error.js';
import { addHours } from '../common/time/wall-clock.js';

const MINUTE_MS = 60_000;
const MAX_AHEAD_HOURS = 180 * 24;

/**
 * Spec §6 time rules. The start must be 30 minutes to 180 days ahead (both ends allowed);
 * the end must be after the start and within 24 hours of it. Pass `checkStart: false` when
 * only the end changed, so an old start is not re-judged against "now".
 * Throws AppError(422) with field `startsLocal` or `endsLocal`.
 */
export function validateEventTimes(
  startsAt: Date,
  endsAt: Date | null,
  now: Date,
  opts: { checkStart?: boolean } = {},
): void {
  if (opts.checkStart !== false) {
    if (startsAt.getTime() < now.getTime() + 30 * MINUTE_MS) throw new AppError(422, 'start.too_soon', 'startsLocal');
    if (startsAt.getTime() > addHours(now, MAX_AHEAD_HOURS).getTime()) throw new AppError(422, 'start.too_far', 'startsLocal');
  }
  if (endsAt) {
    if (endsAt.getTime() <= startsAt.getTime()) throw new AppError(422, 'end.before_start', 'endsLocal');
    if (endsAt.getTime() > addHours(startsAt, 24).getTime()) throw new AppError(422, 'end.too_long', 'endsLocal');
  }
}
