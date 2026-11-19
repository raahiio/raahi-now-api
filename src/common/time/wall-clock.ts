import { DateTime, IANAZone } from 'luxon';

export type WallClockErrorKind = 'invalid' | 'nonexistent' | 'ambiguous';

export class WallClockError extends Error {
  constructor(
    readonly kind: WallClockErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'WallClockError';
  }
}

const LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * Resolve a `YYYY-MM-DDTHH:mm` wall time in an IANA zone to a single instant.
 * Throws WallClockError: 'invalid' (bad format/date/zone), 'nonexistent'
 * (skipped by a spring-forward gap) or 'ambiguous' (repeated at fall-back).
 */
export function resolveWallClock(local: string, tz: string): Date {
  if (!LOCAL_PATTERN.test(local)) {
    throw new WallClockError('invalid', 'local must be YYYY-MM-DDTHH:mm');
  }
  const wall = DateTime.fromISO(local, { zone: 'utc' });
  if (!wall.isValid || wall.toFormat("yyyy-MM-dd'T'HH:mm") !== local) {
    throw new WallClockError('invalid', 'local is not a real date and time');
  }
  if (!IANAZone.isValidZone(tz)) {
    throw new WallClockError('invalid', 'unknown time zone');
  }

  // The wall time read as if it were UTC. An instant matches when its UTC
  // millis plus the zone's offset at that instant equal this value.
  const wallAsUtc = wall.toMillis();
  const offsetAt = (ms: number): number => DateTime.fromMillis(ms, { zone: tz }).offset;
  const candidateOffsets = new Set([offsetAt(wallAsUtc - DAY_MS), offsetAt(wallAsUtc + DAY_MS)]);

  const matches = new Set<number>();
  for (const offsetMinutes of candidateOffsets) {
    const instant = wallAsUtc - offsetMinutes * MINUTE_MS;
    if (offsetAt(instant) === offsetMinutes) matches.add(instant);
  }

  if (matches.size === 0) {
    throw new WallClockError('nonexistent', 'local time does not exist in this time zone');
  }
  if (matches.size > 1) {
    throw new WallClockError('ambiguous', 'local time occurs twice in this time zone');
  }
  return new Date([...matches][0]);
}

export function formatInZone(instant: Date, tz: string): { iso: string; zone: string } {
  const iso = DateTime.fromJSDate(instant, { zone: tz }).toISO({ suppressMilliseconds: true });
  if (iso === null) throw new WallClockError('invalid', 'cannot format instant in this time zone');
  return { iso, zone: tz };
}

export function addHours(instant: Date, hours: number): Date {
  return new Date(instant.getTime() + hours * 60 * MINUTE_MS);
}
