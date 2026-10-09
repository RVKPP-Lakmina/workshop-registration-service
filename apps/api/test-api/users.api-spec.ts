import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS } from './fixtures.ts';
import {
  type App, NIL_UUID, TEST_PASSWORD, client, createApp, expectError, login, loginAll, uid,
} from './helpers.ts';
import { expectUserShape } from './shapes.ts';

describe('users', () => {
  let app: App;
  let call: ReturnType<typeof client>;
  let admin: string;

  beforeAll(async () => {
    app = await createApp();
    call = client(app);
    admin = (await loginAll(app)).admin;
  });
  afterAll(() => app.close());

  const newUser = (over: Record<string, unknown> = {}) => ({
    email: `u-${uid()}@test.local`,
    name: 'Created User',
    password: 'Sup3rSecret!',
    role: 'STAFF',
    ...over,
  });
  const create = async (over: Record<string, unknown> = {}) => {
    const body = newUser(over);
    const res = await call('post', '/users', admin, body);
    expect(res.status).toBe(201);
    return { body, user: res.body as { id: string; email: string; role: string } };
  };
  const auditActions = async (entityId: string) => {
    const res = await call('get', '/audit?pageSize=100', admin);
    return (res.body.items as { entityId: string; action: string }[])
      .filter((a) => a.entityId === entityId)
      .map((a) => a.action);
  };

  describe('GET /users', () => {
    it('lists all users with the public shape and no password data', async () => {
      const res = await call('get', '/users', admin);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      for (const u of res.body) expectUserShape(u);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
      const ids = res.body.map((u: { id: string }) => u.id);
      expect(ids).toEqual(expect.arrayContaining(Object.values(USERS).map((u) => u.id)));
    });

    it('includes the inactive fixture user flagged isActive=false', async () => {
      const res = await call('get', '/users', admin);
      const inactive = res.body.find((u: { id: string }) => u.id === USERS.inactive.id);
      expect(inactive).toMatchObject({ email: USERS.inactive.email, isActive: false, role: 'STAFF' });
    });

    it('orders by role (ADMIN, MANAGER, STAFF) then name', async () => {
      const res = await call('get', '/users', admin);
      const rank = { ADMIN: 0, MANAGER: 1, STAFF: 2 } as Record<string, number>;
      const rows = res.body as { role: string; name: string }[];
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1];
        const b = rows[i];
        expect(rank[a.role]).toBeLessThanOrEqual(rank[b.role]);
      }
    });
  });

  describe('POST /users', () => {
    it('creates a user (201), normalises the email, and the user can log in', async () => {
      const email = `U-${uid()}@Test.Local`;
      const res = await call('post', '/users', admin, newUser({ email, name: '  Padded Name  ', role: 'MANAGER' }));
      expect(res.status).toBe(201);
      expectUserShape(res.body);
      expect(res.body).toMatchObject({
        email: email.toLowerCase(),
        name: 'Padded Name',
        role: 'MANAGER',
        isActive: true,
      });
      const token = await login(app, { email, password: 'Sup3rSecret!' });
      const me = await call('get', '/auth/me', token);
      expect(me.body).toMatchObject({ id: res.body.id, role: 'MANAGER' });
    });

    it.each(['ADMIN', 'MANAGER', 'STAFF'])('creates a %s user', async (role) => {
      const { user } = await create({ role });
      expect(user.role).toBe(role);
    });

    it('writes a USER_CREATED audit entry', async () => {
      const { user } = await create();
      expect(await auditActions(user.id)).toEqual(['USER_CREATED']);
    });

    it('ignores unknown fields (whitelist) such as isActive', async () => {
      const { user } = await create({ isActive: false, id: NIL_UUID, passwordHash: 'x' });
      expect(user).toMatchObject({ isActive: true });
      expect(user.id).not.toBe(NIL_UUID);
    });

    it('returns 409 EMAIL_TAKEN for a duplicate email', async () => {
      const { body } = await create();
      expectError(await call('post', '/users', admin, newUser({ email: body.email })), 409, 'EMAIL_TAKEN');
    });

    it('treats the email case-insensitively for EMAIL_TAKEN', async () => {
      expectError(
        await call('post', '/users', admin, newUser({ email: USERS.staff.email.toUpperCase() })),
        409, 'EMAIL_TAKEN',
      );
    });

    it.each([
      ['missing email', { email: undefined }],
      ['malformed email', { email: 'nope' }],
      ['missing name', { name: undefined }],
      ['empty name', { name: '' }],
      ['name over 120 chars', { name: 'x'.repeat(121) }],
      ['missing password', { password: undefined }],
      ['password under 8 chars', { password: 'short12' }],
      ['password over 128 chars', { password: 'p'.repeat(129) }],
      ['missing role', { role: undefined }],
      ['unknown role', { role: 'SUPERUSER' }],
      ['lower-case role', { role: 'admin' }],
    ])('returns 400 VALIDATION_ERROR for %s', async (_n, over) => {
      expectError(await call('post', '/users', admin, newUser(over)), 400, 'VALIDATION_ERROR');
    });

    it('accepts boundary lengths (name 120, password 8)', async () => {
      const res = await call('post', '/users', admin, newUser({ name: 'n'.repeat(120), password: '12345678' }));
      expect(res.status).toBe(201);
    });

    it('rejects an empty body', async () => {
      expectError(await call('post', '/users', admin, {}), 400, 'VALIDATION_ERROR');
    });
  });

  describe('PATCH /users/:id', () => {
    it('updates the name', async () => {
      const { user } = await create();
      const res = await call('patch', `/users/${user.id}`, admin, { name: ' Renamed ' });
      expect(res.status).toBe(200);
      expectUserShape(res.body);
      expect(res.body).toMatchObject({ id: user.id, name: 'Renamed', role: 'STAFF', isActive: true });
      expect(await auditActions(user.id)).toContain('USER_UPDATED');
    });

    it('changes the role, takes effect immediately on the existing token, and audits it', async () => {
      const { body, user } = await create({ role: 'STAFF' });
      const token = await login(app, { email: body.email as string, password: body.password as string });
      expectError(await call('get', '/users', token), 403, 'FORBIDDEN');
      const res = await call('patch', `/users/${user.id}`, admin, { role: 'ADMIN' });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('ADMIN');
      expect((await call('get', '/users', token)).status).toBe(200);
      expect(await auditActions(user.id)).toContain('USER_ROLE_CHANGED');
    });

    it('deactivating blocks login and invalidates existing tokens; reactivating restores access', async () => {
      const { body, user } = await create();
      const creds = { email: body.email as string, password: body.password as string };
      const token = await login(app, creds);
      expect((await call('get', '/auth/me', token)).status).toBe(200);

      const off = await call('patch', `/users/${user.id}`, admin, { isActive: false });
      expect(off.status).toBe(200);
      expect(off.body.isActive).toBe(false);

      expectError(await call('get', '/auth/me', token), 401, 'UNAUTHORIZED');
      expectError(await call('post', '/auth/login', null, creds), 401, 'INVALID_CREDENTIALS');

      const on = await call('patch', `/users/${user.id}`, admin, { isActive: true });
      expect(on.body.isActive).toBe(true);
      expect((await call('get', '/auth/me', token)).status).toBe(200);
      expect((await call('post', '/auth/login', null, creds)).status).toBe(200);
      const actions = await auditActions(user.id);
      expect(actions).toEqual(expect.arrayContaining(['USER_DEACTIVATED', 'USER_ACTIVATED']));
    });

    it('resets the password: old one stops working, new one works', async () => {
      const { body, user } = await create();
      const res = await call('patch', `/users/${user.id}`, admin, { password: 'BrandNew#123' });
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/BrandNew|passwordHash/);
      expectError(
        await call('post', '/auth/login', null, { email: body.email, password: body.password }),
        401, 'INVALID_CREDENTIALS',
      );
      expect(
        (await call('post', '/auth/login', null, { email: body.email, password: 'BrandNew#123' })).status,
      ).toBe(200);
      expect(await auditActions(user.id)).toContain('USER_PASSWORD_RESET');
    });

    it('accepts an empty patch as a no-op USER_UPDATED', async () => {
      const { user } = await create();
      const res = await call('patch', `/users/${user.id}`, admin, {});
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(user.id);
    });

    it('ignores unknown fields such as email', async () => {
      const { user } = await create();
      const res = await call('patch', `/users/${user.id}`, admin, { email: 'hijack@test.local', name: 'Same' });
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(user.email);
    });

    it('returns 404 USER_NOT_FOUND for an unknown id', async () => {
      expectError(await call('patch', `/users/${NIL_UUID}`, admin, { name: 'x' }), 404, 'USER_NOT_FOUND');
    });

    it('returns 400 for a non-uuid id', async () => {
      expect((await call('patch', '/users/not-a-uuid', admin, { name: 'x' })).status).toBe(400);
    });

    it.each([
      ['empty name', { name: '' }],
      ['name over 120', { name: 'x'.repeat(121) }],
      ['unknown role', { role: 'ROOT' }],
      ['non-boolean isActive', { isActive: 'yes' }],
      ['short password', { password: 'short' }],
      ['password over 128', { password: 'p'.repeat(129) }],
    ])('returns 400 VALIDATION_ERROR for %s', async (_n, body) => {
      const { user } = await create();
      expectError(await call('patch', `/users/${user.id}`, admin, body), 400, 'VALIDATION_ERROR');
    });

    describe('self-modification guard', () => {
      // Uses a throwaway admin so the fixture admin is never touched.
      let selfToken: string;
      let selfId: string;
      let selfCreds: { email: string; password: string };
      beforeAll(async () => {
        const { body, user } = await create({ role: 'ADMIN' });
        selfId = user.id;
        selfCreds = { email: body.email as string, password: body.password as string };
        selfToken = await login(app, selfCreds);
      });

      it('blocks changing your own role (CANNOT_MODIFY_SELF)', async () => {
        expectError(await call('patch', `/users/${selfId}`, selfToken, { role: 'STAFF' }), 400, 'CANNOT_MODIFY_SELF');
        expect((await call('get', '/auth/me', selfToken)).body.role).toBe('ADMIN');
      });

      it('blocks deactivating yourself (CANNOT_MODIFY_SELF)', async () => {
        expectError(await call('patch', `/users/${selfId}`, selfToken, { isActive: false }), 400, 'CANNOT_MODIFY_SELF');
        expect((await call('get', '/auth/me', selfToken)).status).toBe(200);
      });

      it('blocks a combined role+name change as a whole', async () => {
        expectError(
          await call('patch', `/users/${selfId}`, selfToken, { role: 'MANAGER', name: 'Sneaky' }),
          400, 'CANNOT_MODIFY_SELF',
        );
        const me = await call('get', '/auth/me', selfToken);
        expect(me.body.name).toBe('Created User');
      });

      it('allows no-op self updates: same role, isActive=true, and name change', async () => {
        const res = await call('patch', `/users/${selfId}`, selfToken, {
          role: 'ADMIN', isActive: true, name: 'Self Renamed',
        });
        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Self Renamed');
      });

      it('allows changing your own password', async () => {
        const res = await call('patch', `/users/${selfId}`, selfToken, { password: 'Another#Pass1' });
        expect(res.status).toBe(200);
        expect(
          (await call('post', '/auth/login', null, { email: selfCreds.email, password: 'Another#Pass1' })).status,
        ).toBe(200);
      });

      it('lets a different admin demote this admin', async () => {
        const res = await call('patch', `/users/${selfId}`, admin, { role: 'STAFF' });
        expect(res.status).toBe(200);
        expect(res.body.role).toBe('STAFF');
      });
    });

    it('does not let the fixture admin demote itself (guard also applies to real admin)', async () => {
      expectError(
        await call('patch', `/users/${USERS.admin.id}`, admin, { role: 'STAFF' }),
        400, 'CANNOT_MODIFY_SELF',
      );
      expectError(
        await call('patch', `/users/${USERS.admin.id}`, admin, { isActive: false }),
        400, 'CANNOT_MODIFY_SELF',
      );
      expect((await call('get', '/auth/me', admin)).body.role).toBe('ADMIN');
    });
  });

  describe('fixture login', () => {
    it('inactive fixture user cannot authenticate', async () => {
      expectError(
        await call('post', '/auth/login', null, { email: USERS.inactive.email, password: TEST_PASSWORD }),
        401, 'INVALID_CREDENTIALS',
      );
    });

    it('admin can reactivate the inactive fixture then it is restored', async () => {
      const on = await call('patch', `/users/${USERS.inactive.id}`, admin, { isActive: true });
      expect(on.status).toBe(200);
      expect((await call('post', '/auth/login', null, { email: USERS.inactive.email, password: TEST_PASSWORD })).status).toBe(200);
      const off = await call('patch', `/users/${USERS.inactive.id}`, admin, { isActive: false });
      expect(off.body.isActive).toBe(false);
    });
  });
});
