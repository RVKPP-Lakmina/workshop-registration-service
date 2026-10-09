import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createApp, createWorkshop, login, uid } from './helpers.js';

type Method = 'get' | 'post' | 'patch';

describe('access control', () => {
  let app: NestExpressApplication;
  let tokens: { admin: string; manager: string; staff: string };
  let workshopId: string;

  beforeAll(async () => {
    app = await createApp();
    tokens = {
      admin: await login(app, 'admin'),
      manager: await login(app, 'manager'),
      staff: await login(app, 'staff'),
    };
    workshopId = (await createWorkshop(app, tokens.manager, 3)).id;
  });
  afterAll(() => app.close());

  const call = (method: Method, path: string, token?: string, body?: object) => {
    const req = request(app.getHttpServer())[method](`/api${path}`);
    if (token) void req.set('Authorization', `Bearer ${token}`);
    return body ? req.send(body) : req;
  };

  it('rejects requests without a valid token with 401', async () => {
    expect((await call('get', '/workshops')).status).toBe(401);
    expect((await call('get', '/workshops', 'garbage')).status).toBe(401);
    expect((await call('get', '/auth/me')).status).toBe(401);
  });

  it('exposes health without a token', async () => {
    const health = await call('get', '/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
  });

  it('enforces the role matrix', async () => {
    const workshopBody = {
      code: `R-${uid()}`,
      title: 'x',
      instructor: 'y',
      location: 'z',
      startsAt: new Date(Date.now() + 1e8),
      endsAt: new Date(Date.now() + 1.1e8),
      capacity: 3,
    };
    const userBody = {
      email: `u-${uid()}@workshop.local`,
      name: 'U',
      password: 'Password1!',
      role: 'STAFF',
    };
    const attendee = { attendeeName: 'a', attendeeEmail: 'a@example.com' };
    const cases: [string, Method, string, keyof typeof tokens, number, object?][] = [
      ['staff cannot create workshops', 'post', '/workshops', 'staff', 403, workshopBody],
      ['staff cannot edit workshops', 'patch', `/workshops/${workshopId}`, 'staff', 403, { title: 'n' }],
      ['admin cannot list workshops', 'get', '/workshops', 'admin', 403],
      ['admin cannot register', 'post', `/workshops/${workshopId}/registrations`, 'admin', 403, attendee],
      ['manager cannot create users', 'post', '/users', 'manager', 403, userBody],
      ['staff cannot list users', 'get', '/users', 'staff', 403],
      ['manager can create workshops', 'post', '/workshops', 'manager', 201, workshopBody],
      ['staff can list workshops', 'get', '/workshops', 'staff', 200],
      ['admin can create users', 'post', '/users', 'admin', 201, userBody],
      ['admin can list users', 'get', '/users', 'admin', 200],
      ['admin can read the audit log', 'get', '/audit', 'admin', 200],
      ['any role can call /auth/me', 'get', '/auth/me', 'staff', 200],
    ];
    for (const [name, method, path, who, expected, body] of cases) {
      const res = await call(method, path, tokens[who], body);
      expect(res.status, name).toBe(expected);
      if (expected === 403) expect(res.body.code).toBe('FORBIDDEN');
    }
  });

  it('scopes the audit log by role', async () => {
    const admin = await call('get', '/audit', tokens.admin);
    expect(admin.body.items.every((i: any) => i.entityType === 'USER')).toBe(true);
    const manager = await call('get', '/audit', tokens.manager);
    expect(manager.body.items.length).toBeGreaterThan(0);
    expect(manager.body.items.every((i: any) => i.entityType !== 'USER')).toBe(true);
  });

  it('applies deactivation and role changes immediately', async () => {
    const creds = { email: `tmp-${uid()}@workshop.local`, password: 'Password1!' };
    const created = await call('post', '/users', tokens.admin, {
      ...creds,
      name: 'Temp',
      role: 'STAFF',
    });
    const token = await login(app, creds);
    expect((await call('get', '/workshops', token)).status).toBe(200);

    await call('patch', `/users/${created.body.id}`, tokens.admin, { role: 'ADMIN' }).expect(200);
    expect((await call('get', '/workshops', token)).status).toBe(403);

    await call('patch', `/users/${created.body.id}`, tokens.admin, { isActive: false }).expect(200);
    expect((await call('get', '/auth/me', token)).status).toBe(401);
    expect((await call('post', '/auth/login', undefined, creds)).status).toBe(401);
  });

  it('stops an admin demoting or deactivating themselves', async () => {
    const me = (await call('get', '/auth/me', tokens.admin)).body;
    expect((await call('patch', `/users/${me.id}`, tokens.admin, { role: 'STAFF' })).status).toBe(400);
    expect((await call('patch', `/users/${me.id}`, tokens.admin, { isActive: false })).status).toBe(400);
  });

  it('returns the consistent error shape', async () => {
    const res = await call('post', '/workshops', tokens.manager, { code: '' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(typeof res.body.message).toBe('string');
  });
});
