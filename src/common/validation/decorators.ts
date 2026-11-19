import { Transform } from 'class-transformer';
import { registerDecorator, type ValidationArguments } from 'class-validator';
import { containsContactDetails } from './contact-details.js';
import { fuzzyRepeatsExactPlace, mentionsExactPlace } from './exact-place.js';
import { linkProblem } from './links.js';
import { hasControlChars, normalizeText, textLength } from './text.js';

type Check = (value: unknown, args: ValidationArguments) => boolean;
type Code = string | ((value: unknown, args: ValidationArguments) => string);

/** Registers a validator whose failure message is the error code (the pipe turns it into text). */
function custom(name: string, check: Check, code: Code, constraints?: unknown[]): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name,
      target: object.constructor,
      propertyName: propertyName as string,
      constraints,
      options: {
        message: (args) => (typeof code === 'function' ? code(args.value, args) : code),
      },
      validator: { validate: check },
    });
  };
}

/**
 * Plain text: normalizes the value (HTML stripped, edges trimmed, spaces collapsed) before
 * validation, then rejects control characters (`text.control_chars`). `code` is the error for
 * non-string input.
 *
 * The control-character check must see the raw input, because normalizing would erase
 * newlines and tabs. So the transform leaves any value containing control characters
 * untouched, and the validator then rejects it.
 */
export function PlainText(code: string): PropertyDecorator {
  const normalize = Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && !hasControlChars(value) ? normalizeText(value) : value,
  );
  const validate = custom(
    'plainText',
    (v) => typeof v === 'string' && !hasControlChars(v),
    (v) => (typeof v === 'string' ? 'text.control_chars' : code),
  );
  return (object, property) => {
    normalize(object, property);
    validate(object, property);
  };
}

/** Non-string values are left to IsString / PlainText. */
export function NoContactDetails(code = 'text.contact_details'): PropertyDecorator {
  return custom('noContactDetails', (v) => typeof v !== 'string' || !containsContactDetails(v), code);
}

/**
 * The text must not give away the exact place held in another property of the same DTO.
 * Use mode 'fuzzy' for the fuzzy area itself (equality rule) and the default for public text.
 */
export function NotMentioning(exactPlaceProperty: string, mode: 'public' | 'fuzzy' = 'public'): PropertyDecorator {
  const rule = mode === 'fuzzy' ? fuzzyRepeatsExactPlace : mentionsExactPlace;
  return custom(
    'notMentioning',
    (v, args) => {
      const place = (args.object as Record<string, unknown>)[exactPlaceProperty];
      return typeof v !== 'string' || typeof place !== 'string' || !rule(v, place);
    },
    (_v, args) => `${args.property}.exact_place`,
  );
}

export function HttpsNoShortener(): PropertyDecorator {
  return custom(
    'httpsNoShortener',
    (v) => typeof v === 'string' && linkProblem(v) === null,
    (v) => `link.${(typeof v === 'string' ? linkProblem(v) : 'invalid') ?? 'invalid'}`,
  );
}

/** Length in code points of the normalized text. Codes `<field>.too_short` and `<field>.too_long`. */
export function TextRange(min: number, max: number, field: string): PropertyDecorator {
  const length = (v: unknown) => textLength(normalizeText(v as string));
  return custom(
    'textRange',
    (v) => typeof v !== 'string' || (length(v) >= min && length(v) <= max),
    (v) => `${field}.${length(v) < min ? 'too_short' : 'too_long'}`,
    [min, max],
  );
}
