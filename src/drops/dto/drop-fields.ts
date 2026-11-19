import { applyDecorators } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, Max, Min, ValidateBy, ValidateIf } from 'class-validator';
import { NoContactDetails, NotMentioning, PlainText, TextRange } from '../../common/validation/decorators.js';
import { WINDOW_HOURS } from '../drop-state.js';

/** Property decorators shared by the create and update DTOs. Failure messages are error codes. */

export function text(
  field: string,
  min: number,
  max: number,
  opts: { contact?: boolean; place?: 'public' | 'fuzzy' } = {},
): PropertyDecorator {
  return applyDecorators(
    IsString({ message: `${field}.required` }),
    PlainText(`${field}.required`),
    ...(opts.contact ? [NoContactDetails()] : []),
    TextRange(min, max, field),
    ...(opts.place ? [NotMentioning('exactPlace', opts.place)] : []),
  );
}

/** Whole number in [min, max]: `<field>.required` when absent, `<field>.range` otherwise. Declared first so it wins. */
export function whole(field: string, min: number, max: number, opts: { step?: number } = {}): PropertyDecorator {
  const { step } = opts;
  return applyDecorators(
    ValidateBy({
      name: 'wholeNumber',
      validator: {
        validate: (v: unknown) => Number.isInteger(v),
        defaultMessage: (args) => (args?.value === undefined || args?.value === null ? `${field}.required` : `${field}.range`),
      },
    }),
    Min(min, { message: `${field}.range` }),
    Max(max, { message: `${field}.range` }),
    ...(step
      ? [
          ValidateBy({
            name: 'multipleOf',
            validator: { validate: (v: unknown) => typeof v !== 'number' || v % step === 0, defaultMessage: () => `${field}.range` },
          }),
        ]
      : []),
  );
}

/** costMaxUsd >= costMinUsd, code `cost.range`. */
export function costNotBelowMin(): PropertyDecorator {
  return ValidateBy({
    name: 'costNotBelowMin',
    validator: {
      validate: (v: unknown, args) => {
        const min = (args?.object as Record<string, unknown>)?.costMinUsd;
        return typeof v !== 'number' || typeof min !== 'number' || v >= min;
      },
      defaultMessage: () => 'cost.range',
    },
  });
}

export function windowHours(): PropertyDecorator {
  return IsIn([...WINDOW_HOURS], { message: 'windowHours.invalid' });
}

export function standIn(): PropertyDecorator {
  return applyDecorators(IsOptional(), IsBoolean({ message: 'photoIsStandIn.invalid' }));
}

export function idField(field: string): PropertyDecorator {
  return IsString({ message: `${field}.required` });
}

/** Optional and nullable (null clears it). */
export const optional = (inner: PropertyDecorator): PropertyDecorator => applyDecorators(IsOptional(), inner);
/** Absent means unchanged; null is rejected. */
export const patch = (inner: PropertyDecorator): PropertyDecorator =>
  applyDecorators(ValidateIf((_, v) => v !== undefined), inner);
