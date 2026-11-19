import { AppError } from './errors/app-error.js';
import { decodeCursor, encodeCursor, parseLimit } from './pagination.js';

const ID = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';
const T = '2026-11-19T10:00:00.123456Z';
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

const failsWith = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).status).toBe(422);
    expect((e as AppError).code).toBe(code);
    expect((e as AppError).field).toBe(code.split('.')[0]);
    return;
  }
  throw new Error('expected to throw');
};

describe('cursor', () => {
  it('round-trips', () => {
    expect(decodeCursor(encodeCursor({ t: T, id: ID }))).toEqual({ t: T, id: ID });
  });
  it('accepts leap days and microsecond instants as emitted by the repository', () => {
    for (const t of ['2028-02-29T23:59:59.999999Z', '2026-11-19T10:00:00.123456Z', '2000-02-29T00:00:00Z']) {
      expect(decodeCursor(encodeCursor({ t, id: ID }))).toEqual({ t, id: ID });
    }
  });
  it('decodeCursor rejects garbage with cursor.invalid', () => {
    for (const c of ['', '!!!', 'abc', b64('x'), b64(null), b64([]), b64({}), b64({ t: T }), b64({ t: 'nope', id: ID }), b64({ t: T, id: 'nope' }), b64({ t: 5, id: ID }), b64({ t: '2026-13-45T99:00:00Z', id: ID }), b64({ t: '2026-02-30T00:00:00Z', id: ID }), b64({ t: '2026-02-29T00:00:00Z', id: ID }), b64({ t: '2026-11-19T24:00:00Z', id: ID }), b64({ t: '2026-11-19T10:60:00Z', id: ID }), b64({ t: '0000-01-01T00:00:00Z', id: ID })]) {
      failsWith(() => decodeCursor(c), 'cursor.invalid');
    }
  });
});

describe('parseLimit', () => {
  it('undefined gives 20 and 1..50 pass', () => {
    expect(parseLimit(undefined)).toBe(20);
    expect(parseLimit('1')).toBe(1);
    expect(parseLimit('50')).toBe(50);
  });
  it('"0", "51", "abc" and arrays give limit.range', () => {
    for (const raw of ['0', '51', 'abc', '', '-1', '1.5', ['1', '2']]) failsWith(() => parseLimit(raw), 'limit.range');
  });
});
