import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';
import { configureApp } from './configure-app.js';
import { buildOpenApi } from './openapi.js';
import { SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const env = app.get<Env>(ENV);
  if (env.NODE_ENV !== 'production') SwaggerModule.setup('v1/docs', app, buildOpenApi(app));
  await app.listen(env.PORT);
}
await bootstrap();
