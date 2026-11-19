import { ValidationPipe } from '@nestjs/common';
import { getMetadataStorage, type ValidationError } from 'class-validator';
import { ValidationFailedError, type ValidationIssue } from './errors/app-error.js';
import { type MessageVars, messageFor } from './errors/messages.js';

const CODE_SHAPE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$|^[a-z_]+$/;

/** min/max pulled from the constraint metadata of a property (Min, Max, MinLength, MaxLength, Length). */
function boundsFor(target: object | undefined, property: string): MessageVars {
  const vars: MessageVars = {};
  if (!target) return vars;
  const metas = getMetadataStorage().getTargetValidationMetadatas(target.constructor, '', false, false);
  for (const meta of metas) {
    if (meta.propertyName !== property) continue;
    const [a, b] = (meta.constraints ?? []) as unknown[];
    const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
    switch (meta.name) {
      case 'min':
      case 'minLength':
        if (num(a) !== undefined) vars.min = num(a) as number;
        break;
      case 'max':
      case 'maxLength':
        if (num(a) !== undefined) vars.max = num(a) as number;
        break;
      case 'length':
        if (num(a) !== undefined) vars.min = num(a) as number;
        if (num(b) !== undefined) vars.max = num(b) as number;
        break;
    }
  }
  return vars;
}

/**
 * class-validator reports constraints in reverse decorator order, so keys[0] is arbitrary.
 * Rule: a presence/type constraint wins over length/range ones (a missing or wrongly typed
 * value is "required", not "too long"); otherwise the first-declared decorator wins, which
 * is the last key of the reversed list.
 */
const PRESENCE_TYPE_KEYS = new Set([
  'isDefined',
  'isNotEmpty',
  'isString',
  'isInt',
  'isNumber',
  'isBoolean',
  'isIn',
  'isEnum',
  'isArray',
  'isObject',
  'isDateString',
  'isUUID',
]);

function pickConstraintKey(keys: string[]): string {
  return keys.find((k) => PRESENCE_TYPE_KEYS.has(k)) ?? (keys[keys.length - 1] as string);
}

function collect(errors: ValidationError[], prefix: string, out: ValidationIssue[]): void {
  for (const error of errors) {
    const field = prefix ? `${prefix}.${error.property}` : error.property;
    const constraints = error.constraints;
    if (constraints) {
      const keys = Object.keys(constraints);
      let code: string;
      if (keys.includes('whitelistValidation')) {
        code = 'field.unknown';
      } else {
        const text = constraints[pickConstraintKey(keys)] as string;
        code = CODE_SHAPE.test(text) ? text : `${error.property}.invalid`;
      }
      out.push({ code, field, message: messageFor(code, boundsFor(error.target, error.property)) });
    }
    if (error.children?.length) collect(error.children, field, out);
  }
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: true, value: false },
    exceptionFactory: (errors) => {
      const issues: ValidationIssue[] = [];
      collect(errors, '', issues);
      if (issues.length === 0) {
        // Never answer 422 with an empty list.
        const fallback = errors.length ? errors.map((e) => e.property) : [''];
        for (const field of fallback) {
          issues.push({ code: 'bad_request', field, message: messageFor('bad_request') });
        }
      }
      return new ValidationFailedError(issues);
    },
  });
}
