import type { INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { requestIdMiddleware } from './common/request-id.middleware.js';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';
import { createValidationPipe } from './common/validation.js';

export function configureApp(app: INestApplication): void {
  // Behind a load balancer req.ip is the proxy unless the hop count is trusted.
  const { TRUST_PROXY } = app.get<Env>(ENV, { strict: false });
  if (TRUST_PROXY > 0) app.getHttpAdapter().getInstance().set('trust proxy', TRUST_PROXY);
  app.setGlobalPrefix('v1');
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(createValidationPipe());
}
