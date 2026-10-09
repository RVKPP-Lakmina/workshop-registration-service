import {
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { AppError } from './app-error.js';

function run(exception: unknown) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) };
  new AllExceptionsFilter().catch(exception, host as never);
  return {
    status: status.mock.calls[0][0] as number,
    body: json.mock.calls[0][0] as unknown,
  };
}

describe('AllExceptionsFilter', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());

  it('passes AppError through as {statusCode, code, message}', () => {
    const r = run(new AppError(409, 'EMAIL_TAKEN', 'taken'));
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ statusCode: 409, code: 'EMAIL_TAKEN', message: 'taken' });
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('maps class-validator message arrays to VALIDATION_ERROR', () => {
    const r = run(new BadRequestException(['a must be x', 'b must be y']));
    expect(r.body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'a must be x; b must be y',
    });
  });

  it('uses default codes for plain HttpExceptions', () => {
    expect(run(new NotFoundException('nope')).body).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'nope',
    });
    expect(run(new HttpException('slow down', 429)).body).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    expect(run(new HttpException('teapot', 418)).body).toMatchObject({
      code: 'ERROR',
      statusCode: 418,
    });
  });

  it('maps Prisma P2002 to 409 CONFLICT', () => {
    const r = run({ code: 'P2002', message: 'Unique constraint failed on users_email_key' });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({
      statusCode: 409,
      code: 'CONFLICT',
      message: 'The change conflicts with existing data',
    });
  });

  it('maps the capacity CHECK violation to 409 CONFLICT', () => {
    const r = run(new Error('new row violates check constraint "workshops_capacity_check"'));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'CONFLICT' });
  });

  it('turns unknown errors into 500 without leaking internals, and logs them', () => {
    const boom = new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret');
    const r = run(boom);
    expect(r.status).toBe(500);
    expect(r.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong',
    });
    expect(JSON.stringify(r.body)).not.toContain('ECONNREFUSED');
    expect(errSpy).toHaveBeenCalledWith(boom);
  });

  it.each([null, undefined, 'str', 42])('does not crash on non-error throw %s', (v) => {
    expect(run(v).status).toBe(500);
  });
});
