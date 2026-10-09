import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_JWT_SECRET } from './config.ts';
import { REGISTRATIONS, ROLE_KEYS, USERS, WORKSHOPS, type RoleKey } from './fixtures.ts';
import {
  type App, type Method, NIL_UUID, client, createApp, expectError, loginAll,
} from './helpers.ts';

interface Endpoint {
  name: string;
  method: Method;
  path: string;
  body?: object;
  allowed: RoleKey[];
}

const ALL: RoleKey[] = ['admin', 'manager', 'staff'];
const OPS: RoleKey[] = ['manager', 'staff'];

// Allowed roles hit unknown ids or empty bodies so the matrix never mutates fixture
// data (they get 404/400, which proves they passed authentication and authorisation).
const ENDPOINTS: Endpoint[] = [
  { name: 'GET /auth/me', method: 'get', path: '/auth/me', allowed: ALL },
  { name: 'GET /users', method: 'get', path: '/users', allowed: ['admin'] },
  { name: 'POST /users', method: 'post', path: '/users', body: {}, allowed: ['admin'] },
  { name: 'PATCH /users/:id', method: 'patch', path: `/users/${NIL_UUID}`, body: {}, allowed: ['admin'] },
  { name: 'GET /workshops', method: 'get', path: '/workshops', allowed: OPS },
  { name: 'GET /workshops/:id', method: 'get', path: `/workshops/${WORKSHOPS.open.id}`, allowed: OPS },
  { name: 'POST /workshops', method: 'post', path: '/workshops', body: {}, allowed: ['manager'] },
  { name: 'PATCH /workshops/:id', method: 'patch', path: `/workshops/${NIL_UUID}`, body: {}, allowed: ['manager'] },
  { name: 'GET /workshops/:id/registrations', method: 'get', path: `/workshops/${WORKSHOPS.open.id}/registrations`, allowed: OPS },
  {
    name: 'POST /workshops/:id/registrations', method: 'post', path: `/workshops/${NIL_UUID}/registrations`,
    body: { attendeeName: 'X', attendeeEmail: 'x@example.com' }, allowed: OPS,
  },
  { name: 'POST /registrations/:id/cancel', method: 'post', path: `/registrations/${NIL_UUID}/cancel`, body: {}, allowed: OPS },
  { name: 'GET /audit', method: 'get', path: '/audit', allowed: ALL },
];

describe('role x endpoint matrix', () => {
  let app: App;
  let call: ReturnType<typeof client>;
  let tokens: Record<RoleKey, string>;
  let inactiveToken: string;
  beforeAll(async () => {
    app = await createApp();
    call = client(app);
    tokens = await loginAll(app);
    inactiveToken = await new JwtService({ secret: TEST_JWT_SECRET }).signAsync({
      sub: USERS.inactive.id,
    });
  });
  afterAll(() => app.close());

  describe.each(ENDPOINTS)('$name', (ep) => {
    it('401 UNAUTHORIZED without a token', async () => {
      expectError(await call(ep.method, ep.path, null, ep.body), 401, 'UNAUTHORIZED');
    });

    it('401 UNAUTHORIZED with an invalid token', async () => {
      expectError(await call(ep.method, ep.path, 'not.a.token', ep.body), 401, 'UNAUTHORIZED');
    });

    it('401 UNAUTHORIZED for a deactivated user with a still-valid token', async () => {
      expectError(await call(ep.method, ep.path, inactiveToken, ep.body), 401, 'UNAUTHORIZED');
    });

    const forbidden = ROLE_KEYS.filter((r) => !ep.allowed.includes(r));
    it.skipIf(forbidden.length === 0).each(forbidden)(
      '403 FORBIDDEN for %s (even with an invalid body)',
      async (role) => {
        expectError(await call(ep.method, ep.path, tokens[role], ep.body), 403, 'FORBIDDEN');
      },
    );

    it.each(ep.allowed)('lets %s through authentication and authorisation', async (role) => {
      const res = await call(ep.method, ep.path, tokens[role], ep.body);
      expect([401, 403]).not.toContain(res.status);
      expect(res.status).toBeLessThan(500);
    });
  });

  it('keeps health and login public while everything else is default-deny', async () => {
    expect((await call('get', '/health')).status).toBe(200);
    expect((await call('post', '/auth/login', null, {})).status).toBe(400);
  });

  it('answers unknown routes with 404', async () => {
    expect((await call('get', '/nope')).status).toBe(404);
  });

  it('left the fixture registrations untouched by the matrix', async () => {
    const res = await call('get', `/workshops/${WORKSHOPS.open.id}/registrations`, tokens.staff);
    expect(res.body.map((r: { id: string }) => r.id)).toContain(REGISTRATIONS.openAda.id);
  });
});
