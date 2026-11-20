const SHORTENERS = new Set([
  'bit.ly',
  't.co',
  'tinyurl.com',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rebrand.ly',
  'cutt.ly',
  'shorturl.at',
]);

export function linkProblem(url: string): 'not_https' | 'shortened' | 'invalid' | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'invalid';
  }
  if (parsed.protocol === 'http:') return 'not_https';
  if (parsed.protocol !== 'https:') return 'invalid';
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return SHORTENERS.has(host) ? 'shortened' : null;
}
