import { describe, expect, it } from 'vitest';
import { ConfigValidationError, validate } from './validate.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'dev-secret',
};
const good = {
  ...base,
  JWT_SECRET: 'a'.repeat(40),
  CORS_ORIGINS: 'https://workshops.example.com',
};
const problemsOf = (cfg: Record<string, unknown>): string[] => {
  try {
    validate(cfg);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigValidationError);
    return (e as ConfigValidationError).problems;
  }
  return [];
};

describe('config validate', () => {
  it('applies defaults in development', () => {
    const out = validate(base);
    expect(out).toMatchObject({
      APP_ENV: 'development',
      PORT: 3000,
      JWT_EXPIRES_IN: '8h',
      TRUST_PROXY: 'false',
      THROTTLE_DISABLED: 'false',
      SEED_ON_START: 'false',
    });
  });

  it('requires DATABASE_URL, REDIS_URL and JWT_SECRET', () => {
    const problems = problemsOf({});
    expect(problems).toEqual(
      expect.arrayContaining([
        'DATABASE_URL is required',
        'REDIS_URL is required',
        'JWT_SECRET is required',
      ]),
    );
  });

  it('rejects unknown APP_ENV', () => {
    expect(problemsOf({ ...base, APP_ENV: 'qa' })[0]).toMatch(/APP_ENV must be one of/);
  });

  it.each(['abc', '0', '70000', '30.5'])('rejects PORT=%s', (PORT) => {
    expect(problemsOf({ ...base, PORT })[0]).toMatch(/PORT must be a number/);
  });

  it('coerces PORT to a number', () => {
    expect(validate({ ...base, PORT: '4000' }).PORT).toBe(4000);
  });

  it('rejects a malformed JWT_EXPIRES_IN', () => {
    expect(problemsOf({ ...base, JWT_EXPIRES_IN: 'soon' })[0]).toMatch(/JWT_EXPIRES_IN/);
    expect(validate({ ...base, JWT_EXPIRES_IN: '15m' }).JWT_EXPIRES_IN).toBe('15m');
    expect(validate({ ...base, JWT_EXPIRES_IN: '3600' }).JWT_EXPIRES_IN).toBe('3600');
  });

  it('allows weak values in development', () => {
    expect(() =>
      validate({ ...base, APP_ENV: 'development', CORS_ORIGINS: 'http://localhost:5173', THROTTLE_DISABLED: 'true' }),
    ).not.toThrow();
  });

  it.each(['staging', 'production'])('accepts a hardened %s config', (APP_ENV) => {
    expect(validate({ ...good, APP_ENV }).APP_ENV).toBe(APP_ENV);
  });

  it.each(['staging', 'production'])('lists every %s problem in one error', (APP_ENV) => {
    const problems = problemsOf({
      ...base,
      APP_ENV,
      JWT_SECRET: 'CHANGE_ME_short',
      CORS_ORIGINS: 'http://localhost:5173',
      THROTTLE_DISABLED: 'true',
    });
    expect(problems).toHaveLength(4);
    expect(problems.join('\n')).toMatch(/at least 32/);
    expect(problems.join('\n')).toMatch(/CHANGE_ME/);
    expect(problems.join('\n')).toMatch(/localhost/);
    expect(problems.join('\n')).toMatch(/THROTTLE_DISABLED/);
  });

  it('rejects change-me secrets of sufficient length', () => {
    expect(problemsOf({ ...good, APP_ENV: 'production', JWT_SECRET: 'x-change-me-'.padEnd(40, 'x') })).toHaveLength(1);
  });

  it('requires CORS_ORIGINS outside development', () => {
    expect(problemsOf({ ...good, APP_ENV: 'staging', CORS_ORIGINS: '' })).toEqual([
      'CORS_ORIGINS must be set in staging',
    ]);
  });

  it('formats a multi-line error message', () => {
    expect(() => validate({ APP_ENV: 'production' })).toThrow(/Invalid environment configuration[\s\S]*- DATABASE_URL is required/);
  });
});

describe('session cookie settings', () => {
  it('defaults to Lax, not Secure in development, and a stable cookie name', () => {
    const out = validate({ ...base });
    expect(out).toMatchObject({ COOKIE_SECURE: 'false', COOKIE_SAMESITE: 'lax', SESSION_COOKIE_NAME: 'wr_session', COOKIE_DOMAIN: '' });
  });

  it.each(['staging', 'production'])('defaults to Secure in %s', (APP_ENV) => {
    expect(validate({ ...good, APP_ENV }).COOKIE_SECURE).toBe('true');
  });

  it.each(['staging', 'production'])('refuses an insecure cookie in %s', (APP_ENV) => {
    expect(problemsOf({ ...good, APP_ENV, COOKIE_SECURE: 'false' })).toContain(`COOKIE_SECURE must be true in ${APP_ENV}`);
  });

  it('rejects an unknown SameSite value and a non-boolean Secure', () => {
    const problems = problemsOf({ ...base, COOKIE_SAMESITE: 'sometimes', COOKIE_SECURE: 'yes' });
    expect(problems.some((p) => p.startsWith('COOKIE_SAMESITE must be'))).toBe(true);
    expect(problems.some((p) => p.startsWith('COOKIE_SECURE must be'))).toBe(true);
  });

  it('requires Secure when SameSite=none', () => {
    expect(problemsOf({ ...base, COOKIE_SAMESITE: 'none' })).toContain(
      'COOKIE_SAMESITE=none requires COOKIE_SECURE=true (browsers reject it otherwise)',
    );
    expect(problemsOf({ ...base, COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'true' })).toEqual([]);
  });

  it('normalises case and validates the cookie name', () => {
    expect(validate({ ...base, COOKIE_SAMESITE: 'STRICT' }).COOKIE_SAMESITE).toBe('strict');
    expect(problemsOf({ ...base, SESSION_COOKIE_NAME: 'bad name;' }).some((p) => p.startsWith('SESSION_COOKIE_NAME'))).toBe(true);
  });
});
