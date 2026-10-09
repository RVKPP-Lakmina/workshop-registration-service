import type { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';

export const DEFAULT_SESSION_COOKIE = 'wr_session';

export const sessionCookieName = (config: ConfigService) =>
  config.get<string>('SESSION_COOKIE_NAME') || DEFAULT_SESSION_COOKIE;

/** HttpOnly keeps the token out of reach of page scripts; SameSite/Secure come from env (see env/README.md). */
export function sessionCookieOptions(config: ConfigService): CookieOptions {
  const domain = config.get<string>('COOKIE_DOMAIN');
  return {
    httpOnly: true,
    secure: config.get<string>('COOKIE_SECURE') === 'true',
    sameSite: (config.get<string>('COOKIE_SAMESITE') ?? 'lax') as 'lax' | 'strict' | 'none',
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

/** Minimal Cookie-header parser: avoids a dependency for the single cookie we read. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0 || part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim()) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
