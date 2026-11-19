const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const HANDLE = /(?<![\w])@\w+/;
const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/i;
/** A bare domain: dotted labels ending in a TLD of 2+ letters. "end. Next" has a space after the dot, so it never matches. */
const BARE_DOMAIN = /(?<![\w@.-])[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}\b/i;
/** A run of digits joined only by spaces, dashes, dots, parentheses or a leading +. */
const DIGIT_RUN = /[+(]?\d(?:[\d\s().-]*\d)?/g;

function hasPhoneNumber(text: string): boolean {
  for (const run of text.match(DIGIT_RUN) ?? []) {
    if (run.replace(/\D/g, '').length >= 7) return true;
  }
  return false;
}

/** Phone numbers (7+ digits), emails, @handles, URLs and bare domains (spec §3). */
export function containsContactDetails(text: string): boolean {
  return hasPhoneNumber(text) || EMAIL.test(text) || HANDLE.test(text) || URL_LIKE.test(text) || BARE_DOMAIN.test(text);
}
