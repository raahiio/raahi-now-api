export type Platform = 'instagram' | 'threads' | 'x' | 'tiktok' | 'youtube';

const RULES: Record<Platform, { min: number; max: number; chars: RegExp }> = {
  instagram: { min: 1, max: 30, chars: /^[A-Za-z0-9._]+$/ },
  threads: { min: 1, max: 30, chars: /^[A-Za-z0-9._]+$/ },
  x: { min: 1, max: 15, chars: /^[A-Za-z0-9_]+$/ },
  tiktok: { min: 2, max: 24, chars: /^[A-Za-z0-9._]+$/ },
  youtube: { min: 3, max: 30, chars: /^[A-Za-z0-9._]+$/ },
};

export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, '');
}

export function isValidHandle(platform: Platform, handle: string): boolean {
  const rule = RULES[platform];
  return handle.length >= rule.min && handle.length <= rule.max && rule.chars.test(handle);
}
