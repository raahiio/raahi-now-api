import type { INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { requestIdMiddleware } from './common/request-id.middleware.js';
import { createValidationPipe } from './common/validation.js';

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('v1');
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(createValidationPipe());
}
