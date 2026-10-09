/* oxlint-disable typescript/unbound-method */
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC, Public, ROLES, Roles } from '../common/decorators.js';
import { expectAppError, makeCtx } from '../test-utils.js';
import { JwtAuthGuard, RolesGuard } from './guards.js';

describe('decorator metadata', () => {
  it('@Public and @Roles set reflector metadata', () => {
    class C {
      @Public() a() {}
      @Roles('ADMIN', 'MANAGER') b() {}
    }
    const r = new Reflector();
    expect(r.get(IS_PUBLIC, C.prototype.a)).toBe(true);
    expect(r.get(ROLES, C.prototype.b)).toEqual(['ADMIN', 'MANAGER']);
    expect(r.get(IS_PUBLIC, C.prototype.b)).toBeUndefined();
  });
});

describe('JwtAuthGuard', () => {
  const dbUser = {
    id: 'u1',
    email: 'e@x.com',
    name: 'N',
    role: 'STAFF',
    isActive: true,
    passwordHash: 'h',
  };
  const setup = (opts: {
    isPublic?: boolean;
    verify?: () => Promise<unknown>;
    user?: unknown;
  }) => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(opts.isPublic) };
    const jwt = { verifyAsync: vi.fn(opts.verify ?? (async () => ({ sub: 'u1' }))) };
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue(opts.user ?? null) } };
    return {
      jwt,
      prisma,
      guard: new JwtAuthGuard(reflector as never, jwt as never, prisma as never),
    };
  };
  const bearer = makeCtx({ headers: { authorization: 'Bearer t' } });

  it('bypasses public routes without touching jwt or db', async () => {
    const { guard, jwt, prisma } = setup({ isPublic: true });
    expect(await guard.canActivate(makeCtx({ headers: {} }))).toBe(true);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['missing header', undefined],
    ['wrong scheme', 'Basic abc'],
    ['no token', 'Bearer'],
  ])('401 on %s', async (_n, authorization) => {
    const { guard } = setup({});
    await expectAppError(
      guard.canActivate(makeCtx({ headers: { authorization } })),
      401,
      'UNAUTHORIZED',
    );
  });

  it('401 when token verification fails', async () => {
    const { guard } = setup({
      verify: async () => {
        throw new Error('expired');
      },
    });
    await expectAppError(guard.canActivate(bearer), 401, 'UNAUTHORIZED');
  });

  it('401 for unknown user', async () => {
    const { guard } = setup({ user: null });
    await expectAppError(guard.canActivate(bearer), 401, 'UNAUTHORIZED');
  });

  it('401 for deactivated user', async () => {
    const { guard } = setup({ user: { ...dbUser, isActive: false } });
    await expectAppError(guard.canActivate(bearer), 401, 'UNAUTHORIZED');
  });

  it('attaches a sanitized user to the request', async () => {
    const { guard, jwt, prisma } = setup({ user: dbUser });
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer tok' } };
    expect(await guard.canActivate(makeCtx(req))).toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('tok');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });
    expect(req.user).toEqual({ id: 'u1', email: 'e@x.com', name: 'N', role: 'STAFF' });
  });
});

describe('RolesGuard', () => {
  const run = (meta: { isPublic?: boolean; roles?: string[] }, user?: { role: string }) => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) =>
        key === IS_PUBLIC ? meta.isPublic : meta.roles,
      ),
    };
    return new RolesGuard(reflector as never).canActivate(makeCtx({ user }));
  };

  it('allows public routes', () => expect(run({ isPublic: true })).toBe(true));
  it('denies by default when no @Roles metadata', () =>
    expect(() => run({}, { role: 'ADMIN' })).toThrow());
  it('denies when there is no user', () =>
    expect(() => run({ roles: ['ADMIN'] })).toThrow());
  it('denial is a 403 FORBIDDEN', async () => {
    await expectAppError(
      Promise.resolve().then(() => run({ roles: ['ADMIN'] }, { role: 'STAFF' })),
      403,
      'FORBIDDEN',
    );
  });

  const roles = ['ADMIN', 'MANAGER', 'STAFF'];
  const required: string[][] = [
    ['ADMIN'],
    ['MANAGER', 'STAFF'],
    ['ADMIN', 'MANAGER', 'STAFF'],
  ];
  for (const req of required) {
    for (const role of roles) {
      const allowed = req.includes(role);
      it(`${role} vs [${req.join(",")}] -> ${allowed ? 'allow' : 'deny'}`, () => {
        if (allowed) expect(run({ roles: req }, { role })).toBe(true);
        else expect(() => run({ roles: req }, { role })).toThrow();
      });
    }
  }
});
