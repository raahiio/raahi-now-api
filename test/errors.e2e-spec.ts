import { Body, Controller, Get, Logger, Module, Post } from '@nestjs/common';
import { IsString, Max, MaxLength, Min, MinLength, IsInt } from 'class-validator';
import { AppError } from '../src/common/errors/app-error.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';

class TestDto {
  @IsString({ message: 'title.required' })
  @MinLength(5, { message: 'title.too_short' })
  @MaxLength(80, { message: 'title.too_long' })
  title!: string;
}

class AreaDto {
  @IsString({ message: 'area.required' })
  @MinLength(2, { message: 'area.too_short' })
  area!: string;

  @IsInt({ message: 'seats.range' })
  @Min(1, { message: 'seats.range' })
  @Max(5, { message: 'seats.range' })
  seats!: number;
}

@Controller('__test')
class ErrorsTestController {
  @Post('validate')
  validate(@Body() dto: TestDto) {
    return dto;
  }

  @Post('area')
  area(@Body() dto: AreaDto) {
    return dto;
  }

  @Get('app-error')
  appError(): never {
    throw new AppError(404, 'drop.invalid_transition');
  }

  @Get('app-error-field')
  appErrorField(): never {
    throw new AppError(422, 'area.too_short', 'area', { min: 2 });
  }

  @Get('boom')
  boom(): never {
    throw new Error('kaboom internal detail');
  }
}

@Module({ controllers: [ErrorsTestController] })
class ErrorsTestModule {}

describe('Error model (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { imports: [ErrorsTestModule] });
  });
  afterAll(async () => {
    await t?.app.close();
  });

  it('AppError renders code, message and requestId', async () => {
    const res = await t.http.get('/v1/__test/app-error').expect(404);
    expect(res.body).toEqual({
      code: 'drop.invalid_transition',
      message: "That can't be done to this Drop right now.",
      requestId: expect.any(String),
    });
  });

  it('AppError carries field and vars', async () => {
    const res = await t.http.get('/v1/__test/app-error-field').expect(422);
    expect(res.body).toMatchObject({ code: 'area.too_short', field: 'area', message: 'Add at least 2 characters.' });
  });

  it('validation failure returns 422 with one entry per violated field', async () => {
    const res = await t.http.post('/v1/__test/validate').send({ title: 'abc' }).expect(422);
    expect(res.body).toMatchObject({ code: 'validation_failed', errors: [{ code: 'title.too_short', field: 'title' }] });
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].message).toBe('Add at least 5 characters.');
    expect(typeof res.body.requestId).toBe('string');
  });

  it('reports a missing title as required, not too_long', async () => {
    const res = await t.http.post('/v1/__test/validate').send({}).expect(422);
    expect(res.body.errors).toEqual([{ code: 'title.required', field: 'title', message: 'This is needed.' }]);
  });

  it('reports a wrongly typed title as required', async () => {
    const res = await t.http.post('/v1/__test/validate').send({ title: 123 }).expect(422);
    expect(res.body.errors).toEqual([{ code: 'title.required', field: 'title', message: 'This is needed.' }]);
  });

  it('passes min/max from constraints into messages', async () => {
    const res = await t.http.post('/v1/__test/area').send({ area: 'a', seats: 9 }).expect(422);
    const byField = Object.fromEntries(res.body.errors.map((e: { field: string }) => [e.field, e]));
    expect(byField.area.message).toBe('Add at least 2 characters.');
    expect(byField.seats).toMatchObject({ code: 'seats.range', message: 'Use a number from 1 to 5.' });
  });

  it('rejects unknown fields', async () => {
    const res = await t.http.post('/v1/__test/validate').send({ title: 'long enough', extra: 1 }).expect(422);
    expect(res.body.errors).toEqual([{ code: 'field.unknown', field: 'extra', message: "This field isn't allowed." }]);
  });

  it('a validation error never echoes the submitted value', async () => {
    const res = await t.http.post('/v1/__test/validate').send({ title: 'abc', secret: 'SECRET-123' }).expect(422);
    expect(JSON.stringify(res.body)).not.toContain('SECRET-123');
    expect(res.body.errors).toContainEqual(expect.objectContaining({ code: 'field.unknown', field: 'secret' }));
  });

  it('echoes X-Request-Id and generates one when absent', async () => {
    const echoed = await t.http.get('/v1/__test/app-error').set('X-Request-Id', 'req-abc-123').expect(404);
    expect(echoed.headers['x-request-id']).toBe('req-abc-123');
    expect(echoed.body.requestId).toBe('req-abc-123');

    const generated = await t.http.get('/v1/health').expect(200);
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('replaces an unsafe X-Request-Id', async () => {
    const res = await t.http.get('/v1/health').set('X-Request-Id', 'bad id with spaces').expect(200);
    expect(res.headers['x-request-id']).not.toBe('bad id with spaces');
  });

  it('unknown routes return the error shape', async () => {
    const res = await t.http.get('/v1/nope').expect(404);
    expect(res.body).toEqual({ code: 'not_found', message: "We couldn't find that.", requestId: expect.any(String) });
  });

  it('malformed JSON returns a 400 error shape', async () => {
    const res = await t.http.post('/v1/__test/validate').set('Content-Type', 'application/json').send('{bad').expect(400);
    expect(res.body).toMatchObject({ code: 'bad_request', requestId: expect.any(String) });
  });

  it('unhandled errors return 500 internal_error with no stack', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const res = await t.http.get('/v1/__test/boom').expect(500);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
    expect(res.body).toEqual({
      code: 'internal_error',
      message: 'Something went wrong on our side. Try again.',
      requestId: expect.any(String),
    });
    expect(res.body).not.toHaveProperty('stack');
    expect(JSON.stringify(res.body)).not.toContain('kaboom');
  });
});
