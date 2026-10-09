import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { expectAppError } from '../test-utils.js';
import { UsersService, toPublicUser } from './users.service.js';

const row = (o: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'a@b.com',
  name: 'Ann',
  role: 'STAFF',
  isActive: true,
  passwordHash: 'HASH',
  ...o,
});

function setup() {
  const tx = {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    user: { findMany: vi.fn() },
  };
  return { tx, prisma, svc: new UsersService(prisma as never) };
}

describe('toPublicUser', () => {
  it('strips passwordHash', () => {
    expect(toPublicUser(row() as never)).not.toHaveProperty('passwordHash');
  });
});

describe('UsersService.list', () => {
  it('never returns password hashes', async () => {
    const { svc, prisma } = setup();
    prisma.user.findMany.mockResolvedValue([row(), row({ id: 'u2' })]);
    const out = await svc.list();
    expect(out).toHaveLength(2);
    out.forEach((u) => expect(u).not.toHaveProperty('passwordHash'));
  });
});

describe('UsersService.create', () => {
  it('hashes the password, normalises input, audits without the hash', async () => {
    const { svc, tx } = setup();
    tx.user.create.mockImplementation(async ({ data }) => row({ ...data, id: 'new' }));
    const out = await svc.create('admin', {
      email: '  New@X.com ',
      name: ' Bob ',
      password: 'secret-pass',
      role: 'MANAGER',
    });
    const data = tx.user.create.mock.calls[0][0].data;
    expect(data.email).toBe('new@x.com');
    expect(data.name).toBe('Bob');
    expect(data.passwordHash).not.toBe('secret-pass');
    expect(await bcrypt.compare('secret-pass', data.passwordHash)).toBe(true);
    expect(out).not.toHaveProperty('passwordHash');
    const audit = tx.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: 'USER_CREATED', entityType: 'USER', entityId: 'new', actorId: 'admin' });
    expect(JSON.stringify(audit.after)).not.toContain('passwordHash');
  });

  it('maps unique violation to EMAIL_TAKEN', async () => {
    const { svc, tx } = setup();
    tx.user.create.mockRejectedValue({ code: 'P2002' });
    await expectAppError(
      svc.create('admin', { email: 'a@b.com', name: 'n', password: 'pw', role: 'STAFF' }),
      409,
      'EMAIL_TAKEN',
    );
  });

  it('rethrows other errors unchanged', async () => {
    const { svc, tx } = setup();
    const boom = new Error('db down');
    tx.user.create.mockRejectedValue(boom);
    await expect(
      svc.create('admin', { email: 'a@b.com', name: 'n', password: 'pw', role: 'STAFF' }),
    ).rejects.toBe(boom);
  });
});

describe('UsersService.update', () => {
  it('404 when the user does not exist', async () => {
    const { svc, tx } = setup();
    tx.user.findUnique.mockResolvedValue(null);
    await expectAppError(svc.update('admin', 'u1', { name: 'x' }), 404, 'USER_NOT_FOUND');
  });

  it('blocks self role change', async () => {
    const { svc, tx } = setup();
    tx.user.findUnique.mockResolvedValue(row({ role: 'ADMIN' }));
    await expectAppError(svc.update('u1', 'u1', { role: 'STAFF' }), 400, 'CANNOT_MODIFY_SELF');
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('blocks self deactivation', async () => {
    const { svc, tx } = setup();
    tx.user.findUnique.mockResolvedValue(row({ role: 'ADMIN' }));
    await expectAppError(svc.update('u1', 'u1', { isActive: false }), 400, 'CANNOT_MODIFY_SELF');
  });

  it('allows self update of unchanged role / name / password', async () => {
    const { svc, tx } = setup();
    tx.user.findUnique.mockResolvedValue(row({ role: 'ADMIN' }));
    tx.user.update.mockResolvedValue(row({ role: 'ADMIN', name: 'New' }));
    const out = await svc.update('u1', 'u1', { role: 'ADMIN', isActive: true, name: ' New ' });
    expect(out.name).toBe('New');
    expect(tx.user.update.mock.calls[0][0].data.name).toBe('New');
  });

  it('hashes a new password and never returns or audits the hash', async () => {
    const { svc, tx } = setup();
    tx.user.findUnique.mockResolvedValue(row());
    tx.user.update.mockResolvedValue(row({ passwordHash: 'NEWHASH' }));
    const out = await svc.update('admin', 'u1', { password: 'brand-new-pw' });
    const { passwordHash } = tx.user.update.mock.calls[0][0].data;
    expect(await bcrypt.compare('brand-new-pw', passwordHash)).toBe(true);
    expect(out).not.toHaveProperty('passwordHash');
    const audit = tx.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('USER_PASSWORD_RESET');
    expect(JSON.stringify([audit.before, audit.after])).not.toContain('HASH');
  });

  it('leaves passwordHash undefined when no password is given', async () => {
    const { svc, tx } = setup();
    tx.user.findUnique.mockResolvedValue(row());
    tx.user.update.mockResolvedValue(row());
    await svc.update('admin', 'u1', { name: 'x' });
    expect(tx.user.update.mock.calls[0][0].data.passwordHash).toBeUndefined();
  });

  it.each([
    ['role change', { role: 'MANAGER' as const }, row(), 'USER_ROLE_CHANGED'],
    ['deactivate', { isActive: false }, row(), 'USER_DEACTIVATED'],
    ['activate', { isActive: true }, row({ isActive: false }), 'USER_ACTIVATED'],
    ['rename', { name: 'Z' }, row(), 'USER_UPDATED'],
  ])('audit action for %s', async (_n, input, before, action) => {
    const { svc, tx } = setup();
    tx.user.findUnique.mockResolvedValue(before);
    tx.user.update.mockResolvedValue(row());
    await svc.update('admin', 'u1', input);
    expect(tx.auditLog.create.mock.calls[0][0].data.action).toBe(action);
  });
});
