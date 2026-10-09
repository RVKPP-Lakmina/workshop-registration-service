import { describe, expect, it } from 'vitest';
import { AppThrottlerGuard } from './throttler.guard.js';

describe('AppThrottlerGuard.getTracker', () => {
  // getTracker doesn't use injected deps, so skip the DI constructor.
  const guard = Object.create(AppThrottlerGuard.prototype) as unknown as {
    getTracker(req: Record<string, unknown>): Promise<string>;
  };
  const track = (req: Record<string, unknown>) => guard.getTracker(req);

  it('keys authenticated callers by user id, ignoring IP', async () => {
    expect(
      await track({ user: { id: 'u1' }, ip: '1.1.1.1', originalUrl: '/auth/login' }),
    ).toBe('user:u1');
  });
  it('keys anonymous requests by IP', async () => {
    expect(await track({ ip: '1.2.3.4', originalUrl: '/workshops' })).toBe('ip:1.2.3.4');
  });
  it('falls back to "unknown" without an IP', async () => {
    expect(await track({})).toBe('ip:unknown');
  });
  it('keys login by ip + normalised email, ignoring query string', async () => {
    expect(
      await track({
        ip: '1.2.3.4',
        originalUrl: '/api/auth/login?x=1',
        body: { email: '  Foo@Bar.COM ' },
      }),
    ).toBe('login:1.2.3.4:foo@bar.com');
  });
  it('login without a body email yields an empty email segment', async () => {
    expect(await track({ ip: '9.9.9.9', originalUrl: '/auth/login' })).toBe('login:9.9.9.9:');
  });
});
