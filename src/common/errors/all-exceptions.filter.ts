import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestIdOf } from '../request-id.middleware.js';
import { AppError, ValidationFailedError } from './app-error.js';
import { messageFor } from './messages.js';

const CODE_BY_STATUS: Record<number, string> = {
  401: 'auth.required',
  403: 'forbidden',
  404: 'not_found',
  429: 'rate_limited',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const requestId = requestIdOf(res);

    if (exception instanceof ValidationFailedError) {
      res.status(422).json({ code: 'validation_failed', errors: exception.errors, requestId });
      return;
    }

    if (exception instanceof AppError) {
      const { code, field, vars, status } = exception;
      res.status(status).json({ code, ...(field ? { field } : {}), message: messageFor(code, vars), requestId });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status < 500) {
        const code = CODE_BY_STATUS[status] ?? 'bad_request';
        res.status(status).json({ code, message: messageFor(code), requestId });
        return;
      }
    }

    this.logger.error(
      `${req.method} ${req.originalUrl} [${requestId}] ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`,
    );
    res.status(500).json({ code: 'internal_error', message: messageFor('internal_error'), requestId });
  }
}
