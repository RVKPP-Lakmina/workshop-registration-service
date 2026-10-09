import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService, writeAudit } from './audit.service.js';

describe('writeAudit', () => {
  it('writes a row, using DbNull for missing before and JSON-cloning after', async () => {
    const create = vi.fn();
    const when = new Date('2025-01-01T00:00:00Z');
    await writeAudit({ auditLog: { create } } as never, {
      actorId: 'a',
      action: 'X',
      entityType: 'USER',
      entityId: 'e',
      after: { when, n: undefined, k: 1 },
    });
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ actorId: 'a', action: 'X', entityType: 'USER', entityId: 'e' });
    expect(data.before).toBe(Prisma.DbNull);
    expect(data.after).toEqual({ when: when.toISOString(), k: 1 });
  });

  it('treats null before as DbNull too', async () => {
    const create = vi.fn();
    await writeAudit({ auditLog: { create } } as never, {
      actorId: 'a',
      action: 'X',
      entityType: 'USER',
      entityId: 'e',
      before: null,
    });
    expect(create.mock.calls[0][0].data.before).toBe(Prisma.DbNull);
  });
});

describe('AuditService.list', () => {
  const setup = () => {
    const prisma = {
      auditLog: {
        count: vi.fn().mockResolvedValue(25),
        findMany: vi.fn().mockResolvedValue([{ id: 7n, action: 'A' }]),
      },
    };
    return { prisma, svc: new AuditService(prisma as never) };
  };

  it('ADMIN sees only USER entries', async () => {
    const { svc, prisma } = setup();
    await svc.list('ADMIN', 1, 10);
    expect(prisma.auditLog.count).toHaveBeenCalledWith({ where: { entityType: 'USER' } });
  });

  it('non-admin sees workshop + registration entries', async () => {
    const { svc, prisma } = setup();
    await svc.list('MANAGER', 1, 10);
    expect(prisma.auditLog.count).toHaveBeenCalledWith({
      where: { entityType: { in: ['WORKSHOP', 'REGISTRATION'] } },
    });
  });

  it('paginates, orders newest first and stringifies bigint ids', async () => {
    const { svc, prisma } = setup();
    const out = await svc.list('ADMIN', 3, 10);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10, orderBy: { id: 'desc' } }),
    );
    expect(out).toEqual({ items: [{ id: '7', action: 'A' }], total: 25, page: 3, pageSize: 10 });
  });
});
