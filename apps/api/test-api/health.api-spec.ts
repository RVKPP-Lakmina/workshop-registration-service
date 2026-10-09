import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, client, createApp } from './helpers.ts';

describe('GET /health', () => {
  let app: App;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('is public and reports ok when database and redis are reachable', async () => {
    const res = await client(app)('get', '/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('ignores an invalid token (public route)', async () => {
    const res = await client(app)('get', '/health', 'garbage');
    expect(res.status).toBe(200);
  });

  it('is only exposed under the /api prefix', async () => {
    const res = await client(app)('get', '/health');
    expect(res.status).toBe(200);
    const bare = await (await import('supertest')).default(app.getHttpServer()).get('/health');
    expect(bare.status).toBe(404);
  });
});
