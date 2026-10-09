import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createApp, uid } from './helpers.js';

describe('login throttle', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    // Read when the module is created, so set it before createApp().
    process.env.THROTTLE_DISABLED = 'false';
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    process.env.THROTTLE_DISABLED = 'true';
  });

  const attempt = (email: string) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'wrong' });

  it('returns 429 on the 11th login attempt for the same email', async () => {
    const email = `nobody-${uid()}@workshop.local`;
    const statuses: number[] = [];
    let last;
    for (let i = 0; i < 11; i++) {
      last = await attempt(email);
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(last!.body.code).toBe('TOO_MANY_REQUESTS');
  });

  it('does not throttle a different email from the same IP', async () => {
    const res = await attempt(`other-${uid()}@workshop.local`);
    expect(res.status).toBe(401);
  });
});
