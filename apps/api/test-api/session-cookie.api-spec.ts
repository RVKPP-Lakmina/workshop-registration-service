import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS } from './fixtures.ts';
import { type App, TEST_PASSWORD, createApp, expectError, sessionToken } from './helpers.ts';

/** HttpOnly cookie session: how the browser authenticates (Bearer stays for scripts and the other suites). */
describe('session cookie', () => {
  let app: App;
  const http = () => request(app.getHttpServer());
  const loginRes = (key: keyof typeof USERS = 'manager') =>
    http().post('/api/auth/login').send({ email: USERS[key].email, password: TEST_PASSWORD });
  const cookieOf = (token: string) => `wr_session=${token}`;

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  describe('POST /auth/login', () => {
    it('sets an HttpOnly, SameSite session cookie scoped to / and expiring with the JWT', async () => {
      const res = await loginRes();
      expect(res.status).toBe(200);
      const [cookie] = res.headers['set-cookie'] as unknown as string[];
      expect(cookie).toMatch(/^wr_session=[\w-]+\.[\w-]+\.[\w-]+;/);
      expect(cookie).toMatch(/;\s*HttpOnly/i);
      expect(cookie).toMatch(/;\s*SameSite=Lax/i);
      expect(cookie).toMatch(/;\s*Path=\/(;|$)/);
      const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie)?.[1]);
      expect(maxAge).toBeGreaterThan(0);
      expect(maxAge).toBeLessThanOrEqual(8 * 3600); // JWT_EXPIRES_IN default
    });

    it('never puts the token in the response body', async () => {
      const res = await loginRes();
      expect(JSON.stringify(res.body)).not.toContain(sessionToken(res));
      expect(res.body.token).toBeUndefined();
    });

    it('sets no cookie when the login fails', async () => {
      const res = await http().post('/api/auth/login').send({ email: USERS.staff.email, password: 'wrong-password' });
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('authenticating with the cookie', () => {
    it('GET /auth/me works with only the cookie', async () => {
      const token = sessionToken(await loginRes('staff'));
      const res = await http().get('/api/auth/me').set('Cookie', cookieOf(token));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: USERS.staff.id, role: 'STAFF' });
    });

    it('rejects a forged or malformed cookie with 401', async () => {
      for (const value of ['not.a.jwt', '', 'a.b.c']) {
        const res = await http().get('/api/auth/me').set('Cookie', cookieOf(value));
        expectError(res, 401, 'UNAUTHORIZED');
      }
    });

    it('ignores a cookie with another name', async () => {
      const token = sessionToken(await loginRes());
      expectError(await http().get('/api/auth/me').set('Cookie', `other=${token}`), 401, 'UNAUTHORIZED');
    });

    it('finds the session among several cookies', async () => {
      const token = sessionToken(await loginRes());
      const res = await http().get('/api/auth/me').set('Cookie', `a=1; ${cookieOf(token)}; b=2`);
      expect(res.status).toBe(200);
    });
  });

  describe('CSRF defence for cookie-authenticated writes', () => {
    it('refuses a write without X-Requested-With (403 CSRF_REJECTED)', async () => {
      const token = sessionToken(await loginRes('manager'));
      const res = await http().post('/api/workshops').set('Cookie', cookieOf(token)).send({});
      expectError(res, 403, 'CSRF_REJECTED');
    });

    it('accepts the same write when X-Requested-With is present (reaches validation)', async () => {
      const token = sessionToken(await loginRes('manager'));
      const res = await http()
        .post('/api/workshops')
        .set('Cookie', cookieOf(token))
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({});
      expectError(res, 400, 'VALIDATION_ERROR');
    });

    it('never asks for the header on reads', async () => {
      const token = sessionToken(await loginRes('manager'));
      const res = await http().get('/api/workshops').set('Cookie', cookieOf(token));
      expect(res.status).toBe(200);
    });

    it('does not require it for Bearer clients (no ambient cookie to ride on)', async () => {
      const token = sessionToken(await loginRes('manager'));
      const res = await http().post('/api/workshops').set('Authorization', `Bearer ${token}`).send({});
      expectError(res, 400, 'VALIDATION_ERROR');
    });

    it('still enforces roles for cookie sessions: Staff cannot create workshops', async () => {
      const token = sessionToken(await loginRes('staff'));
      const res = await http()
        .post('/api/workshops')
        .set('Cookie', cookieOf(token))
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({});
      expectError(res, 403, 'FORBIDDEN');
    });
  });

  describe('POST /auth/logout', () => {
    it('clears the cookie with matching attributes and returns 204', async () => {
      const token = sessionToken(await loginRes());
      const res = await http().post('/api/auth/logout').set('Cookie', cookieOf(token));
      expect(res.status).toBe(204);
      const [cleared] = res.headers['set-cookie'] as unknown as string[];
      expect(cleared).toMatch(/^wr_session=;/);
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);
      expect(cleared).toMatch(/;\s*HttpOnly/i);
      expect(cleared).toMatch(/;\s*Path=\//);
    });

    it('is public: succeeds with no or an expired session', async () => {
      expect((await http().post('/api/auth/logout')).status).toBe(204);
      expect((await http().post('/api/auth/logout').set('Cookie', cookieOf('expired.or.invalid'))).status).toBe(204);
    });
  });
});
