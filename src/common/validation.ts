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
        const text = constraints[keys[0] as string] as string;
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
      return new ValidationFailedError(issues);
    },
  });
}
