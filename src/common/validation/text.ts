/** C0 (U+0000-U+001F) and DEL/C1 (U+007F-U+009F) control characters. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

/** True when the raw (un-normalized) text contains any control character, newline and tab included. */
export function hasControlChars(raw: string): boolean {
  return CONTROL_CHARS.test(raw);
}

/** Plain-text rule (spec §3): strip HTML tags, collapse runs of whitespace, trim the edges. */
export function normalizeText(raw: string): string {
  return raw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** Length in Unicode code points (an emoji counts as one). */
export function textLength(s: string): number {
  return Array.from(s).length;
}
