import { APP_ENVS, type AppEnv } from './env-file.js';

const DURATION = /^\d+$|^\d+\s?(ms|s|m|h|d|w|y)$/i;

export class ConfigValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Invalid environment configuration (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\nFix env/.env.<APP_ENV> (see env/README.md) or the process environment.',
    );
    this.name = 'ConfigValidationError';
  }
}

const str = (v: unknown) =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';

/**
 * ConfigModule `validate` hook. Returns the config with defaults applied, or throws one
 * error that lists every problem so boot fails fast and clearly.
 */
export function validate(config: Record<string, unknown>): Record<string, unknown> {
  const problems: string[] = [];
  const appEnvRaw = str(config.APP_ENV) || 'development';
  const appEnv = appEnvRaw as AppEnv;
  if (!APP_ENVS.includes(appEnv)) {
    problems.push(`APP_ENV must be one of ${APP_ENVS.join(', ')} (got "${appEnvRaw}")`);
  }

  for (const key of ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET']) {
    if (!str(config[key])) problems.push(`${key} is required`);
  }

  const portRaw = str(config.PORT) || '3000';
  const port = Number(portRaw);
  if (!/^\d+$/.test(portRaw) || port < 1 || port > 65535) {
    problems.push(`PORT must be a number between 1 and 65535 (got "${portRaw}")`);
  }

  const jwtExpires = str(config.JWT_EXPIRES_IN) || '8h';
  if (!DURATION.test(jwtExpires)) {
    problems.push(`JWT_EXPIRES_IN must be seconds or a duration like 15m, 8h, 7d (got "${jwtExpires}")`);
  }

  if (appEnv === 'staging' || appEnv === 'production') {
    const secret = str(config.JWT_SECRET);
    if (secret && secret.length < 32) {
      problems.push(`JWT_SECRET must be at least 32 characters in ${appEnv} (got ${secret.length})`);
    }
    if (/change[_-]?me/i.test(secret)) {
      problems.push(`JWT_SECRET still contains a CHANGE_ME placeholder; set a real secret in ${appEnv}`);
    }
    const origins = str(config.CORS_ORIGINS);
    if (!origins) {
      problems.push(`CORS_ORIGINS must be set in ${appEnv}`);
    } else if (/localhost|127\.0\.0\.1|\[::1\]/i.test(origins)) {
      problems.push(`CORS_ORIGINS must not contain localhost in ${appEnv} (got "${origins}")`);
    }
    if (str(config.THROTTLE_DISABLED).toLowerCase() === 'true') {
      problems.push(`THROTTLE_DISABLED must not be true in ${appEnv}`);
    }
  }

  const sameSite = (str(config.COOKIE_SAMESITE) || 'lax').toLowerCase();
  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    problems.push(`COOKIE_SAMESITE must be lax, strict or none (got "${str(config.COOKIE_SAMESITE)}")`);
  }
  const secureRaw = str(config.COOKIE_SECURE).toLowerCase();
  if (secureRaw && !['true', 'false'].includes(secureRaw)) {
    problems.push(`COOKIE_SECURE must be true or false (got "${str(config.COOKIE_SECURE)}")`);
  }
  // Secure defaults on everywhere except plain-http local development.
  const cookieSecure = secureRaw ? secureRaw === 'true' : appEnv !== 'development';
  if (sameSite === 'none' && !cookieSecure) {
    problems.push('COOKIE_SAMESITE=none requires COOKIE_SECURE=true (browsers reject it otherwise)');
  }
  if ((appEnv === 'staging' || appEnv === 'production') && !cookieSecure) {
    problems.push(`COOKIE_SECURE must be true in ${appEnv}`);
  }
  const cookieName = str(config.SESSION_COOKIE_NAME) || 'wr_session';
  if (!/^[A-Za-z0-9_-]+$/.test(cookieName)) {
    problems.push(`SESSION_COOKIE_NAME may only contain letters, digits, "_" and "-" (got "${cookieName}")`);
  }

  if (problems.length) throw new ConfigValidationError(problems);

  return {
    ...config,
    APP_ENV: appEnv,
    PORT: port,
    JWT_EXPIRES_IN: jwtExpires,
    CORS_ORIGINS: str(config.CORS_ORIGINS),
    TRUST_PROXY: str(config.TRUST_PROXY) || 'false',
    THROTTLE_DISABLED: str(config.THROTTLE_DISABLED) || 'false',
    SEED_ON_START: str(config.SEED_ON_START) || 'false',
    COOKIE_SECURE: String(cookieSecure),
    COOKIE_SAMESITE: sameSite,
    COOKIE_DOMAIN: str(config.COOKIE_DOMAIN),
    SESSION_COOKIE_NAME: cookieName,
  };
}
