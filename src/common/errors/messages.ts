export type MessageVars = Record<string, string | number>;

/** Every user-facing message, verbatim from spec §10 (plus plan-level codes, ruling R1). */
export const MESSAGES: Record<string, string> = {
  // Spec §10
  'title.exact_place': 'This mentions the exact spot. Keep it for the hidden field so travelers unlock it.',
  'whyNow.exact_place': 'This mentions the exact spot. Keep it for the hidden field so travelers unlock it.',
  'watchOut.exact_place': 'This mentions the exact spot. Keep it for the hidden field so travelers unlock it.',
  'watchOut.required': 'Add a watch-out so travelers know what to expect.',
  'windowHours.invalid': 'Choose how long this Drop stays live.',
  'whyNow.too_short': 'Add at least 20 characters so travelers know why this is worth doing today.',
  'image.too_small': 'This photo is a little small. Use one at least 800 px on its shortest side.',
  'drop.submitted': "Thanks. We'll review your Drop and start the clock when it goes live.",
  'start.too_soon': 'Pick a start at least 30 minutes from now.',
  'end.before_start': 'The end needs to be after the start.',
  'event.duplicate': 'You already have this event at about that time. Edit it instead?',
  'link.shortened': 'Use the full link instead of a shortened one.',
  'event.guest_submitted': "Thanks! We'll take a quick look before it goes up, and email you at {email}.",
  'text.contact_details': 'Keep phone numbers, emails and links out of this field.',
  'text.control_chars': 'Remove the special characters from this field.',
  'link.not_https': 'Use a link that starts with https://.',
  'tz.invalid': 'Choose a valid time zone.',
  'market.invalid': 'Choose one of the listed markets.',
  'market.required': 'Choose one of the listed markets.',
  'start.too_far': 'Pick a start within the next 180 days.',
  'end.too_long': 'The end must be within 24 hours of the start.',
  'start.nonexistent_time':
    "That time doesn't exist, or happens twice, at the daylight-saving change. Pick another time.",
  'start.ambiguous_time':
    "That time doesn't exist, or happens twice, at the daylight-saving change. Pick another time.",
  'image.type': 'Use a JPEG, PNG or WebP photo.',
  'image.too_large': 'Use a photo up to 5 MB.',
  'photo.not_ready': 'Wait for the photo to finish uploading, then try again.',
  'drop.limit_live': 'You can have 5 live Drops at a time. End one to submit another.',
  'drop.invalid_transition': "That can't be done to this Drop right now.",
  'drop.field_locked': "This can't be changed while the Drop is live. End it and create a new one.",
  'drop.cap_lower': 'The daily limit can only go up while a Drop is live.',
  'drop.local_required': 'Only verified locals can post Drops.',
  'event.invalid_transition': "That can't be done to this event right now.",
  'event.not_editable': "This event can't be changed any more.",
  'review.reason_required': 'Add a reason of at least 5 characters so the poster knows why.',
  'review.not_pending': 'This item has already been reviewed.',
  rate_limited: "You've reached today's limit. Try again later.",
  'claim.invalid': "That claim code doesn't match.",
  'claim.locked': 'Too many tries. Try again in an hour.',
  'auth.required': 'Log in to continue.',
  'auth.invalid_token': 'Your session has expired. Log in again.',
  'limit.range': 'Use a limit from 1 to 50.',
  'cursor.invalid': "That page link isn't valid.",
  internal_error: 'Something went wrong on our side. Try again.',

  // Plan-level codes not in §10 (ruling R1)
  forbidden: "You don't have access to this.",
  not_found: "We couldn't find that.",
  bad_request: "We couldn't read that request.",
  'field.unknown': "This field isn't allowed.",
  'media.not_pending': 'This upload has already been processed.',
  'device.required': 'Add the X-Device-Id header to post as a guest.',
};

/** Generic per-suffix texts for `<field>.<suffix>` codes with no exact entry. */
const GENERIC_BY_SUFFIX: Record<string, string> = {
  too_short: 'Add at least {min} characters.',
  too_long: 'Use at most {max} characters.',
  required: 'This is needed.',
  range: 'Use a number from {min} to {max}.',
  exact_place: MESSAGES['watchOut.exact_place'] as string,
  invalid: 'Check this value.',
};

const SOCIALS_INVALID = 'Enter the handle without spaces or symbols.';
const FALLBACK = 'Check this value.';

function template(code: string): string {
  if (Object.hasOwn(MESSAGES, code)) return MESSAGES[code] as string;
  if (/^socials\.[^.]+\.invalid$/.test(code)) return SOCIALS_INVALID;
  const suffix = code.slice(code.lastIndexOf('.') + 1);
  return code.includes('.') ? (Object.hasOwn(GENERIC_BY_SUFFIX, suffix) ? (GENERIC_BY_SUFFIX[suffix] as string) : FALLBACK) : FALLBACK;
}

/** Resolve a code to its message, filling `{placeholders}` from vars. */
export function messageFor(code: string, vars: MessageVars = {}): string {
  const text = template(code);
  let missing = false;
  const filled = text.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined) {
      missing = true;
      return '';
    }
    return String(value);
  });
  return missing ? FALLBACK : filled;
}
