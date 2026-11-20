import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPIObject } from '@nestjs/swagger';
import { buildOpenApi } from '../src/openapi.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { closeTestDbs } from './support/db.js';
import { missingRoutes, registeredRoutes } from './support/openapi.js';

describe('OpenAPI (e2e)', () => {
  let t: TestApp;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    t = await createTestApp();
    doc = buildOpenApi(t.app);
  });
  afterAll(async () => {
    await t.app.close();
    await closeTestDbs();
  });

  it('the OpenAPI document is valid', async () => {
    await expect(SwaggerParser.validate(structuredClone(doc) as never)).resolves.toBeDefined();
  });

  it('every registered route appears in the document', () => {
    expect(registeredRoutes(t.app).length).toBeGreaterThan(20);
    expect(missingRoutes(t.app, doc)).toEqual([]);
  });

  it('declares the bearer, claim code and device id security schemes', () => {
    expect(Object.keys(doc.components?.securitySchemes ?? {}).sort()).toEqual(['bearer', 'claimCode', 'deviceId']);
  });

  it('CreateDropDto documents the spec limits', () => {
    const schemas = doc.components!.schemas as Record<string, { properties: Record<string, { minLength?: number; maxLength?: number }> }>;
    const title = schemas.CreateDropDto!.properties.title!;
    expect([title.minLength, title.maxLength]).toEqual([5, 80]);
  });
});
