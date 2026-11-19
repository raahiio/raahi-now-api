import { addHours, formatInZone, resolveWallClock } from './wall-clock.js';

describe('wall-clock', () => {
  it('resolves New York wall time', () =>
    expect(resolveWallClock('2026-11-14T14:00', 'America/New_York').toISOString()).toBe('2026-11-14T19:00:00.000Z'));
  it('resolves Tokyo wall time', () =>
    expect(resolveWallClock('2026-11-14T14:00', 'Asia/Tokyo').toISOString()).toBe('2026-11-14T05:00:00.000Z'));
  it('resolves Colombo (UTC+5:30)', () =>
    expect(resolveWallClock('2026-11-14T14:00', 'Asia/Colombo').toISOString()).toBe('2026-11-14T08:30:00.000Z'));
  it('rejects a time skipped at spring-forward', () =>
    expect(() => resolveWallClock('2026-03-08T02:30', 'America/New_York')).toThrow(
      expect.objectContaining({ kind: 'nonexistent' }),
    ));
  it('rejects a time repeated at fall-back', () =>
    expect(() => resolveWallClock('2026-11-01T01:30', 'America/New_York')).toThrow(
      expect.objectContaining({ kind: 'ambiguous' }),
    ));
  it('accepts the hour after the fall-back repeat', () =>
    expect(resolveWallClock('2026-11-01T02:30', 'America/New_York').toISOString()).toBe('2026-11-01T07:30:00.000Z'));
  it('rejects malformed input and unknown zones', () => {
    expect(() => resolveWallClock('2026-13-40T99:00', 'America/New_York')).toThrow(
      expect.objectContaining({ kind: 'invalid' }),
    );
    expect(() => resolveWallClock('2026-11-14T14:00', 'Mars/Base')).toThrow(expect.objectContaining({ kind: 'invalid' }));
  });
  it('rejects non-canonical formats and impossible dates', () => {
    for (const bad of ['2026-11-14 14:00', '2026-11-14T14:00:00', '2026-11-14T14:00Z', '2026-02-30T10:00', '2026-11-14T24:00', '']) {
      expect(() => resolveWallClock(bad, 'Asia/Tokyo')).toThrow(expect.objectContaining({ kind: 'invalid' }));
    }
  });
  it('detects 30-minute DST shifts in Lord Howe', () => {
    expect(() => resolveWallClock('2026-10-04T02:15', 'Australia/Lord_Howe')).toThrow(
      expect.objectContaining({ kind: 'nonexistent' }),
    );
    expect(() => resolveWallClock('2026-04-05T01:45', 'Australia/Lord_Howe')).toThrow(
      expect.objectContaining({ kind: 'ambiguous' }),
    );
    expect(resolveWallClock('2026-10-04T02:45', 'Australia/Lord_Howe').toISOString()).toBe('2026-10-03T15:45:00.000Z');
  });
  it('formats an instant in its zone', () => {
    expect(formatInZone(new Date('2026-11-14T19:00:00Z'), 'America/New_York')).toEqual({
      iso: '2026-11-14T14:00:00-05:00',
      zone: 'America/New_York',
    });
    expect(formatInZone(new Date('2026-11-14T08:30:00Z'), 'Asia/Colombo').iso).toBe('2026-11-14T14:00:00+05:30');
  });
  it('adds hours as UTC arithmetic', () => {
    expect(addHours(new Date('2026-03-08T06:00:00Z'), 24).toISOString()).toBe('2026-03-09T06:00:00.000Z');
    expect(addHours(new Date('2026-11-14T19:00:00Z'), 1.5).toISOString()).toBe('2026-11-14T20:30:00.000Z');
  });
});
