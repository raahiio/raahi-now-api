import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Raahi NOW API')
    .setVersion('1')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Claim-Code' }, 'claimCode')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Device-Id' }, 'deviceId')
    .build();
  return SwaggerModule.createDocument(app, config);
}
