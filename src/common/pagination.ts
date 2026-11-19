import { AppError } from './errors/app-error.js';

export interface Cursor {
  t: string;
  id: string;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

export function encodeCursor(v: Cursor): string {
  return Buffer.from(JSON.stringify({ t: v.t, id: v.id }), 'utf8').toString('base64url');
}

/** Strict decode: anything but base64url JSON `{ t: ISO instant, id: UUID }` is 422 `cursor.invalid`. */
export function decodeCursor(c: string): Cursor {
  const bad = () => new AppError(422, 'cursor.invalid', 'cursor');
  if (typeof c !== 'string' || !/^[A-Za-z0-9_-]+$/.test(c)) throw bad();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw bad();
  const { t, id } = parsed as Record<string, unknown>;
  if (typeof t !== 'string' || !ISO_INSTANT.test(t) || Number.isNaN(Date.parse(t))) throw bad();
  if (typeof id !== 'string' || !UUID.test(id)) throw bad();
  return { t, id };
}

/** Default 20; whole numbers 1..50; anything else is 422 `limit.range`. */
export function parseLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  if (typeof raw !== 'string' || !/^\d{1,3}$/.test(raw)) throw new AppError(422, 'limit.range', 'limit');
  const n = Number(raw);
  if (n < 1 || n > MAX_LIMIT) throw new AppError(422, 'limit.range', 'limit');
  return n;
}
