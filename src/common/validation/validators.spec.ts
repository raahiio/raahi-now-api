import 'reflect-metadata';
import { IsOptional, IsString } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { createValidationPipe } from '../validation.js';
import { containsContactDetails } from './contact-details.js';
import { HttpsNoShortener, NoContactDetails, NotMentioning, PlainText, TextRange } from './decorators.js';
import { fuzzyRepeatsExactPlace, mentionsExactPlace } from './exact-place.js';
import { isValidHandle, normalizeHandle } from './handles.js';
import { linkProblem } from './links.js';
import { hasControlChars, normalizeText, textLength } from './text.js';

const PLACE = "Back counter, Fong's Grocery, 14 Eldridge Street";

describe('validators', () => {
  it.each([
    ['+1 555 010 0100', true],
    ['call 555-0100 now', true],
    ['a@b.co', true],
    ['@priya_k', true],
    ['see example.com', true],
    ['https://x.com/a', true],
    ['Open 9 to 5', false],
    ['Room 12, floor 3', false],
    ['Fold your own, 8 stools', false],
    ['The end. Next stop', false],
  ])('containsContactDetails(%s) = %s', (t, v) => expect(containsContactDetails(t)).toBe(v));

  it('mentionsExactPlace finds a street segment', () =>
    expect(mentionsExactPlace('Dumplings at 14 Eldridge Street', PLACE)).toBe(true));
  it('mentionsExactPlace allows the area-level name', () =>
    expect(mentionsExactPlace('Dumpling Counter on Eldridge', PLACE)).toBe(false));
  it('fuzzyRepeatsExactPlace flags an equal segment', () =>
    expect(fuzzyRepeatsExactPlace('14 Eldridge Street', PLACE)).toBe(true));

  it.each([
    ['https://example.com/menu', null],
    ['http://example.com', 'not_https'],
    ['https://bit.ly/menu', 'shortened'],
    ['nonsense', 'invalid'],
  ])('linkProblem(%s)', (u, v) => expect(linkProblem(u)).toBe(v));

  it.each([
    ['instagram', 'priya.k', true],
    ['instagram', 'a'.repeat(31), false],
    ['x', 'abcdefghijklmnop', false],
    ['x', 'a.b', false],
    ['tiktok', 'a', false],
    ['youtube', 'ab', false],
    ['threads', 'a'.repeat(30), true],
  ])('isValidHandle(%s,%s)', (p, h, v) => expect(isValidHandle(p as never, h)).toBe(v));

  it('normalizeHandle strips a leading @', () => expect(normalizeHandle('@priya')).toBe('priya'));
  it('normalizeText strips HTML and collapses spaces', () =>
    expect(normalizeText('  <b>Hi</b>   there ')).toBe('Hi there'));
  it('textLength counts an emoji as one', () => expect(textLength('🍜🍜🍜🍜🍜')).toBe(5));
  it('a title of spaces fails the minimum', () => expect(textLength(normalizeText('       '))).toBe(0));
  it('hasControlChars detects a NUL', () => expect(hasControlChars('a\u0000b')).toBe(true));
});

class Dto {
  @IsString({ message: 'title.required' })
  @PlainText('title.required')
  @TextRange(5, 20, 'title')
  @NoContactDetails()
  @NotMentioning('exactPlace')
  title!: string;

  @IsOptional()
  @HttpsNoShortener()
  link?: string;

  @IsOptional()
  @IsString()
  exactPlace?: string;
}

async function run(body: object) {
  const pipe = createValidationPipe();
  try {
    return { ok: await pipe.transform(body, { type: 'body', metatype: Dto }) };
  } catch (e) {
    return { err: (e as { errors: { code: string; field: string; message: string }[] }).errors };
  }
}

describe('decorators through the validation pipe', () => {
  it('normalizes the stored value', async () => {
    const r = await run({ title: '  <b>Hello</b>   you ' });
    expect(r.ok?.title).toBe('Hello you');
  });
  it('reports too_short with its minimum', async () => {
    const r = await run({ title: '   ab   ' });
    expect(r.err?.[0]).toMatchObject({ code: 'title.too_short', message: 'Add at least 5 characters.' });
  });
  it('reports too_long with its maximum', async () => {
    const r = await run({ title: 'x'.repeat(21) });
    expect(r.err?.[0]).toMatchObject({ code: 'title.too_long', message: 'Use at most 20 characters.' });
  });
  it('rejects control characters instead of normalizing them away', async () => {
    const r = await run({ title: 'Hello\nthere' });
    expect(r.err?.[0]?.code).toBe('text.control_chars');
  });
  it('rejects contact details', async () => {
    const r = await run({ title: 'a@b.co ok' });
    expect(r.err?.[0]?.code).toBe('text.contact_details');
  });
  it('rejects text mentioning the exact place', async () => {
    const r = await run({ title: 'Eldridge Street', exactPlace: 'Shop, Eldridge Street' });
    expect(r.err?.[0]?.code).toBe('title.exact_place');
  });
  it('maps link problems to their codes', async () => {
    expect((await run({ title: 'Hello you', link: 'http://a.com' })).err?.[0]?.code).toBe('link.not_https');
    expect((await run({ title: 'Hello you', link: 'https://bit.ly/x' })).err?.[0]?.code).toBe('link.shortened');
  });
  it('a non-string title is "required"', async () => {
    const r = await run({ title: 5 });
    expect(r.err?.[0]?.code).toBe('title.required');
  });
});
