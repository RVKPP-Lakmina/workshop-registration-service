import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { expectAppError } from '../test-utils.js';
import { AuthService } from './auth.service.js';

describe('AuthService.login', () => {
  let hash: string;
  const base = () => ({
    id: 'u1',
    email: 'a@b.com',
    name: 'Ann',
    role: 'MANAGER',
    isActive: true,
    passwordHash: hash,
  });
  beforeAll(() => {
    hash = bcrypt.hashSync('correct-horse', 4);
  });

  const setup = (user: unknown) => {
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue(user) } };
    const jwt = { signAsync: vi.fn().mockResolvedValue('signed.jwt') };
    return { prisma, jwt, svc: new AuthService(prisma as never, jwt as never) };
  };

  it('returns token and public user, signs {sub, role}, normalises email', async () => {
    const { svc, prisma, jwt } = setup(base());
    const out = await svc.login('  A@B.com ', 'correct-horse');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.com' } });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', role: 'MANAGER' });
    expect(out.token).toBe('signed.jwt');
    expect(out.user).not.toHaveProperty('passwordHash');
    expect(out.user).toMatchObject({ id: 'u1', email: 'a@b.com' });
  });

  it('rejects wrong password with INVALID_CREDENTIALS', async () => {
    const { svc, jwt } = setup(base());
    await expectAppError(svc.login('a@b.com', 'nope'), 401, 'INVALID_CREDENTIALS');
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('rejects unknown email with the same error', async () => {
    const { svc } = setup(null);
    await expectAppError(svc.login('x@y.com', 'whatever'), 401, 'INVALID_CREDENTIALS');
  });

  it('rejects inactive user even with the right password', async () => {
    const { svc, jwt } = setup({ ...base(), isActive: false });
    await expectAppError(svc.login('a@b.com', 'correct-horse'), 401, 'INVALID_CREDENTIALS');
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
