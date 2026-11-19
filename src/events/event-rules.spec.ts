import { AppError } from '../common/errors/app-error.js';
import { validateEventTimes } from './event-rules.js';

const now = new Date('2026-11-19T12:00:00Z');
const at = (ms: number) => new Date(now.getTime() + ms);
const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;

const codeOf = (fn: () => void): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
  return undefined;
};

describe('validateEventTimes', () => {
  it('rejects a start 29 minutes ahead (start.too_soon)', () =>
    expect(codeOf(() => validateEventTimes(at(29 * MIN), null, now))).toBe('start.too_soon'));
  it('accepts 30 minutes ahead', () => expect(codeOf(() => validateEventTimes(at(30 * MIN), null, now))).toBeUndefined());
  it('rejects a start 181 days ahead (start.too_far)', () =>
    expect(codeOf(() => validateEventTimes(at(181 * DAY), null, now))).toBe('start.too_far'));
  it('accepts 180 days ahead', () => expect(codeOf(() => validateEventTimes(at(180 * DAY), null, now))).toBeUndefined());
  it('rejects an end equal to the start (end.before_start)', () =>
    expect(codeOf(() => validateEventTimes(at(DAY), at(DAY), now))).toBe('end.before_start'));
  it('rejects an end 24h01m after the start (end.too_long)', () =>
    expect(codeOf(() => validateEventTimes(at(DAY), at(DAY + 24 * H + MIN), now))).toBe('end.too_long'));
  it('accepts an end exactly 24 hours after the start', () =>
    expect(codeOf(() => validateEventTimes(at(DAY), at(DAY + 24 * H), now))).toBeUndefined());
  it('skips the start window when checkStart is false', () =>
    expect(codeOf(() => validateEventTimes(at(-H), at(H), now, { checkStart: false }))).toBeUndefined());
});
