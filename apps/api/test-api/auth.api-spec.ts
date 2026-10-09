import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_JWT_SECRET } from './config.ts';
import { USERS } from './fixtures.ts';
import {
  type App, NIL_UUID, TEST_PASSWORD, client, createApp, expectError, login,
} from './helpers.ts';
import { expectUserShape } from './shapes.ts';

describe('auth', () => {
  let app: App;
  let call: ReturnType<typeof client>;
  beforeAll(async () => {
    app = await createApp();
    call = client(app);
  });
  afterAll(() => app.close());

  describe('POST /auth/login', () => {
    it.each(['admin', 'manager', 'staff'] as const)('logs in the %s fixture user', async (key) => {
      const res = await call('post', '/auth/login', null, {
        email: USERS[key].email,
        password: TEST_PASSWORD,
      });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['token', 'user']);
      expect(res.body.token.split('.')).toHaveLength(3);
      expectUserShape(res.body.user);
      expect(res.body.user).toMatchObject({
        id: USERS[key].id,
        email: USERS[key].email,
        name: USERS[key].name,
        role: USERS[key].role,
        isActive: true,
      });
    });

    it('matches the email case-insensitively', async () => {
      const res = await call('post', '/auth/login', null, {
        email: USERS.staff.email.toUpperCase(),
        password: TEST_PASSWORD,
      });
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(USERS.staff.id);
    });

    it('rejects a wrong password with 401 INVALID_CREDENTIALS', async () => {
      expectError(
        await call('post', '/auth/login', null, { email: USERS.staff.email, password: 'nope' }),
        401, 'INVALID_CREDENTIALS',
      );
    });

    it('rejects an unknown email with the same error (no user enumeration)', async () => {
      const unknown = await call('post', '/auth/login', null, {
        email: 'nobody@test.local', password: TEST_PASSWORD,
      });
      const wrong = await call('post', '/auth/login', null, {
        email: USERS.staff.email, password: 'nope',
      });
      expectError(unknown, 401, 'INVALID_CREDENTIALS');
      expect(unknown.body).toEqual(wrong.body);
    });

    it('rejects a deactivated user even with the right password', async () => {
      expectError(
        await call('post', '/auth/login', null, {
          email: USERS.inactive.email, password: TEST_PASSWORD,
        }),
        401, 'INVALID_CREDENTIALS',
      );
    });

    it.each([
      ['empty body', {}],
      ['missing password', { email: USERS.staff.email }],
      ['missing email', { password: TEST_PASSWORD }],
      ['malformed email', { email: 'not-an-email', password: 'x' }],
      ['empty password', { email: USERS.staff.email, password: '' }],
      ['non-string password', { email: USERS.staff.email, password: 12345 }],
    ])('returns 400 VALIDATION_ERROR for %s', async (_name, body) => {
      expectError(await call('post', '/auth/login', null, body), 400, 'VALIDATION_ERROR');
    });

    it('never returns the password hash', async () => {
      const res = await call('post', '/auth/login', null, {
        email: USERS.admin.email, password: TEST_PASSWORD,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });
  });

  describe('GET /auth/me', () => {
    it.each(['admin', 'manager', 'staff'] as const)('returns the %s identity', async (key) => {
      const res = await call('get', '/auth/me', await login(app, key));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: USERS[key].id,
        email: USERS[key].email,
        name: USERS[key].name,
        role: USERS[key].role,
      });
    });

    it('returns 401 without a token', async () => {
      expectError(await call('get', '/auth/me'), 401, 'UNAUTHORIZED');
    });

    it('returns 401 for a non-Bearer scheme', async () => {
      const token = await login(app, 'staff');
      const res = await call('get', '/auth/me').set('Authorization', `Basic ${token}`);
      expectError(res, 401, 'UNAUTHORIZED');
    });

    it('returns 401 for a garbage token', async () => {
      expectError(await call('get', '/auth/me', 'garbage'), 401, 'UNAUTHORIZED');
    });

    it('returns 401 for a tampered token', async () => {
      const token = await login(app, 'admin');
      const [h, p, s] = token.split('.');
      const tampered = `${h}.${p}.${s.slice(0, -2)}${s.endsWith('AA') ? 'BB' : 'AA'}`;
      expectError(await call('get', '/auth/me', tampered), 401, 'UNAUTHORIZED');
    });

    it('returns 401 for a token signed with another secret', async () => {
      const forged = await new JwtService({ secret: 'some-other-secret-value-0123456789' })
        .signAsync({ sub: USERS.admin.id, role: 'ADMIN' });
      expectError(await call('get', '/auth/me', forged), 401, 'UNAUTHORIZED');
    });

    it('returns 401 for an expired token', async () => {
      const expired = await new JwtService({ secret: TEST_JWT_SECRET })
        .signAsync({ sub: USERS.admin.id, role: 'ADMIN' }, { expiresIn: -10 });
      expectError(await call('get', '/auth/me', expired), 401, 'UNAUTHORIZED');
    });

    it('returns 401 for a validly signed token whose user does not exist', async () => {
      const ghost = await new JwtService({ secret: TEST_JWT_SECRET })
        .signAsync({ sub: NIL_UUID, role: 'ADMIN' });
      expectError(await call('get', '/auth/me', ghost), 401, 'UNAUTHORIZED');
    });

    it('returns 401 for a validly signed token of a deactivated user', async () => {
      const t = await new JwtService({ secret: TEST_JWT_SECRET })
        .signAsync({ sub: USERS.inactive.id, role: 'STAFF' });
      expectError(await call('get', '/auth/me', t), 401, 'UNAUTHORIZED');
    });

    it('takes the role from the database, not from the token claim', async () => {
      const t = await new JwtService({ secret: TEST_JWT_SECRET })
        .signAsync({ sub: USERS.staff.id, role: 'ADMIN' });
      const res = await call('get', '/auth/me', t);
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('STAFF');
      expectError(await call('get', '/users', t), 403, 'FORBIDDEN');
    });
  });
});
