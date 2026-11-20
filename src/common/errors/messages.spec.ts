import { MESSAGES, messageFor } from './messages.js';

describe('messageFor', () => {
  it('returns the spec text', () =>
    expect(messageFor('start.too_soon')).toBe('Pick a start at least 30 minutes from now.'));

  it('fills placeholders', () =>
    expect(messageFor('event.guest_submitted', { email: 'a@b.co' })).toBe(
      "Thanks! We'll take a quick look before it goes up, and email you at a@b.co.",
    ));

  it('falls back to the generic field messages', () => {
    expect(messageFor('area.too_short', { min: 2 })).toBe('Add at least 2 characters.');
    expect(messageFor('area.too_long', { max: 9 })).toBe('Use at most 9 characters.');
    expect(messageFor('area.required')).toBe('This is needed.');
    expect(messageFor('seats.range', { min: 1, max: 5 })).toBe('Use a number from 1 to 5.');
  });

  it('prefers an exact entry over the generic fallback', () =>
    expect(messageFor('whyNow.too_short', { min: 20 })).toBe(
      'Add at least 20 characters so travelers know why this is worth doing today.',
    ));

  it('resolves <field>.exact_place for any field', () =>
    expect(messageFor('title.exact_place')).toBe(MESSAGES['watchOut.exact_place']));

  it('resolves socials.<platform>.invalid', () =>
    expect(messageFor('socials.instagram.invalid')).toBe('Enter the handle without spaces or symbols.'));

  it('gives pairs their own text', () => {
    expect(messageFor('image.type')).toBe('Use a JPEG, PNG or WebP photo.');
    expect(messageFor('image.too_large')).toBe('Use a photo up to 5 MB.');
    expect(messageFor('limit.range')).toBe('Use a limit from 1 to 50.');
    expect(messageFor('cursor.invalid')).toBe("That page link isn't valid.");
    expect(messageFor('start.ambiguous_time')).toBe(MESSAGES['start.nonexistent_time']);
  });

  it('has plan-level and generic fallbacks', () => {
    expect(messageFor('forbidden')).toBe("You don't have access to this.");
    expect(messageFor('field.unknown')).toBe("This field isn't allowed.");
    expect(messageFor('title.invalid')).toBe('Check this value.');
    expect(messageFor('totally.unmapped_code')).toBe('Check this value.');
  });

  it('ignores prototype keys', () => {
    expect(messageFor('constructor')).toBe('Check this value.');
    expect(messageFor('x.constructor')).toBe('Check this value.');
    expect(messageFor('toString')).toBe('Check this value.');
  });

  it('never leaves a literal placeholder', () => {
    expect(messageFor('area.too_short')).not.toMatch(/[{}]/);
    expect(messageFor('event.guest_submitted')).not.toMatch(/[{}]/);
  });
});
