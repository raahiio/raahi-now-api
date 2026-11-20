import type { MessageVars } from './messages.js';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly field?: string,
    readonly vars?: MessageVars,
  ) {
    super(code);
    this.name = 'AppError';
  }
}

export interface ValidationIssue {
  code: string;
  field: string;
  message: string;
}

/** 422 `validation_failed` carrying one issue per violated field. */
export class ValidationFailedError extends AppError {
  constructor(readonly errors: ValidationIssue[]) {
    super(422, 'validation_failed');
    this.name = 'ValidationFailedError';
  }
}
