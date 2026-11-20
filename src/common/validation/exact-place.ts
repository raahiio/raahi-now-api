/** Lower case, punctuation removed, spaces collapsed (spec §5 "Exact place text" rule). */
function normalizePlace(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function segments(exactPlace: string): string[] {
  return exactPlace
    .split(',')
    .map(normalizePlace)
    .filter((s) => s.length > 0);
}

/** A public field breaks the rule if it contains any exact-place segment of 6 or more characters. */
export function mentionsExactPlace(publicText: string, exactPlace: string): boolean {
  const text = normalizePlace(publicText);
  return segments(exactPlace).some((seg) => seg.length >= 6 && text.includes(seg));
}

/** The fuzzy area breaks the rule if, normalized, it equals a segment or the whole exact place. */
export function fuzzyRepeatsExactPlace(fuzzy: string, exactPlace: string): boolean {
  const f = normalizePlace(fuzzy);
  if (f.length === 0) return false;
  return f === normalizePlace(exactPlace) || segments(exactPlace).includes(f);
}
