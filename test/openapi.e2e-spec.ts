import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPIObject } from '@nestjs/swagger';
import { getMetadataStorage } from 'class-validator';
import { CreateDropDto } from '../src/drops/dto/create-drop.dto.js';
import { RaiseCapDto } from '../src/drops/dto/raise-cap.dto.js';
import { UpdateDropDto } from '../src/drops/dto/update-drop.dto.js';
import { CreateEventDto } from '../src/events/dto/create-event.dto.js';
import { UpdateEventDto } from '../src/events/dto/update-event.dto.js';
import { ExchangeClaimDto, RecoverClaimDto } from '../src/guests/claims.dto.js';
import { SocialsDto, UpdateMeDto } from '../src/me/me.dto.js';
import { CreateUploadDto } from '../src/media/media.dto.js';
import { ReasonDto } from '../src/review/review.dto.js';
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

  type Schema = { properties?: Record<string, unknown>; required?: string[] };
  const schema = (name: string) => (doc.components!.schemas as Record<string, Schema>)[name];
  const validatedProps = (dto: new () => object) =>
    [...new Set(getMetadataStorage().getTargetValidationMetadatas(dto, '', false, false).map((m) => m.propertyName))].sort();

  // Every request DTO, with the properties a client must send.
  const DTOS: [new () => object, string[]][] = [
    [
      CreateDropDto,
      ['title', 'whyNow', 'perfectFor', 'costMinUsd', 'costMaxUsd', 'timeMinutes', 'watchOut', 'photoMediaId', 'marketId', 'fuzzyArea', 'exactPlace', 'windowHours', 'unlocksPerDay', 'unlockPriceCredits'],
    ],
    [UpdateDropDto, []],
    [RaiseCapDto, ['unlocksPerDay']],
    [CreateEventDto, ['name', 'category', 'marketId', 'description', 'startsLocal', 'area']],
    [UpdateEventDto, []],
    [CreateUploadDto, ['contentType', 'sizeBytes']],
    [ReasonDto, ['reason']],
    [ExchangeClaimDto, ['code']],
    [RecoverClaimDto, ['email']],
    [UpdateMeDto, []],
    [SocialsDto, []],
  ];

  it.each(DTOS.map(([dto, required]) => [dto.name, dto, required] as const))(
    '%s lists every request property and the right required ones',
    (name, dto, required) => {
      const s = schema(name);
      expect(s, name).toBeDefined();
      expect(Object.keys(s!.properties ?? {}).sort()).toEqual(validatedProps(dto));
      expect([...(s!.required ?? [])].sort()).toEqual([...required].sort());
    },
  );

  it('CreateEventDto has category, marketId and startsLocal as required', () => {
    const s = schema('CreateEventDto')!;
    for (const key of ['category', 'marketId', 'startsLocal']) {
      expect(s.properties).toHaveProperty(key);
      expect(s.required).toContain(key);
    }
  });

  it('CreateDropDto requires photoMediaId and marketId', () => {
    expect(schema('CreateDropDto')!.required).toEqual(expect.arrayContaining(['photoMediaId', 'marketId']));
  });

  it('CreateUploadDto has contentType and sizeBytes', () => {
    expect(Object.keys(schema('CreateUploadDto')!.properties ?? {}).sort()).toEqual(['contentType', 'sizeBytes']);
  });
});

