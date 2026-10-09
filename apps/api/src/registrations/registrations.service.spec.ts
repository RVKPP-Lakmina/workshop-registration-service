import { describe, expect, it, vi } from 'vitest';
import { expectAppError } from '../test-utils.js';
import { RegistrationsService } from './registrations.service.js';
import { activate, lockNextWaitlisted } from './waitlist.js';

const CAP = Symbol('capacityField');

function setup() {
  const tx = {
    workshop: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      fields: { capacity: CAP },
    },
    registration: {
      create: vi.fn(async ({ data }) => ({ id: 'r-new', ...data })),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
  };
  const prisma = {
    $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    workshop: { findUnique: vi.fn() },
    registration: { findMany: vi.fn() },
  };
  return { tx, prisma, svc: new RegistrationsService(prisma as never) };
}
type Tx = ReturnType<typeof setup>['tx'];
const auditActions = (tx: Tx) => tx.auditLog.create.mock.calls.map((c) => c[0].data.action);

const input = { attendeeName: ' Ann ', attendeeEmail: ' ANN@X.com ' };

describe('RegistrationsService.register', () => {
  it('seat available -> ACTIVE with normalised attendee, uses atomic guarded increment', async () => {
    const { svc, tx } = setup();
    tx.workshop.updateMany.mockResolvedValue({ count: 1 });
    const reg = await svc.register('actor', 'w1', input);
    expect(tx.workshop.updateMany).toHaveBeenCalledWith({
      where: { id: 'w1', status: 'SCHEDULED', activeCount: { lt: CAP } },
      data: { activeCount: { increment: 1 } },
    });
    expect(reg).toMatchObject({
      status: 'ACTIVE',
      attendeeName: 'Ann',
      attendeeEmail: 'ann@x.com',
      registeredById: 'actor',
    });
    expect(auditActions(tx)).toEqual(['REGISTRATION_CREATED']);
    expect(tx.workshop.findUnique).not.toHaveBeenCalled();
  });

  it('full + joinWaitlistIfFull -> WAITLISTED without incrementing', async () => {
    const { svc, tx } = setup();
    tx.workshop.updateMany.mockResolvedValue({ count: 0 });
    tx.workshop.findUnique.mockResolvedValue({ status: 'SCHEDULED' });
    const reg = await svc.register('a', 'w1', { ...input, joinWaitlistIfFull: true });
    expect(reg.status).toBe('WAITLISTED');
    expect(tx.workshop.updateMany).toHaveBeenCalledTimes(1);
    expect(auditActions(tx)).toEqual(['REGISTRATION_WAITLISTED']);
  });

  it('full without the flag -> WORKSHOP_FULL and nothing is created', async () => {
    const { svc, tx } = setup();
    tx.workshop.updateMany.mockResolvedValue({ count: 0 });
    tx.workshop.findUnique.mockResolvedValue({ status: 'SCHEDULED' });
    await expectAppError(svc.register('a', 'w1', input), 409, 'WORKSHOP_FULL');
    expect(tx.registration.create).not.toHaveBeenCalled();
  });

  it.each(['CANCELLED', 'COMPLETED'])('%s workshop -> WORKSHOP_NOT_OPEN even with waitlist flag', async (status) => {
    const { svc, tx } = setup();
    tx.workshop.updateMany.mockResolvedValue({ count: 0 });
    tx.workshop.findUnique.mockResolvedValue({ status });
    await expectAppError(
      svc.register('a', 'w1', { ...input, joinWaitlistIfFull: true }),
      409,
      'WORKSHOP_NOT_OPEN',
    );
  });

  it('missing workshop -> 404', async () => {
    const { svc, tx } = setup();
    tx.workshop.updateMany.mockResolvedValue({ count: 0 });
    tx.workshop.findUnique.mockResolvedValue(null);
    await expectAppError(svc.register('a', 'w1', input), 404, 'WORKSHOP_NOT_FOUND');
  });

  it('duplicate attendee (P2002) -> ALREADY_REGISTERED; other errors pass through', async () => {
    const { svc, tx } = setup();
    tx.workshop.updateMany.mockResolvedValue({ count: 1 });
    tx.registration.create.mockRejectedValueOnce({ code: 'P2002' });
    await expectAppError(svc.register('a', 'w1', input), 409, 'ALREADY_REGISTERED');
    const boom = new Error('x');
    tx.registration.create.mockRejectedValueOnce(boom);
    await expect(svc.register('a', 'w1', input)).rejects.toBe(boom);
  });
});

describe('RegistrationsService.listForWorkshop', () => {
  it('404 for unknown workshop, otherwise lists oldest first', async () => {
    const { svc, prisma } = setup();
    prisma.workshop.findUnique.mockResolvedValueOnce(null);
    await expectAppError(svc.listForWorkshop('w1'), 404, 'WORKSHOP_NOT_FOUND');
    prisma.workshop.findUnique.mockResolvedValueOnce({ id: 'w1' });
    prisma.registration.findMany.mockResolvedValue([{ id: 'r' }]);
    expect(await svc.listForWorkshop('w1')).toEqual([{ id: 'r' }]);
    expect(prisma.registration.findMany.mock.calls[0][0].orderBy).toEqual([
      { registeredAt: 'asc' },
      { id: 'asc' },
    ]);
  });
});

describe('RegistrationsService.cancel', () => {
  const prime = (
    tx: Tx,
    o: { before?: object; count?: number; workshopStatus?: string; next?: string | null } = {},
  ) => {
    const before = { id: 'r1', status: 'ACTIVE', ...o.before };
    tx.registration.findUnique.mockResolvedValue({ workshopId: 'w1' });
    tx.registration.findUniqueOrThrow
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce({ ...before, status: 'CANCELLED' });
    tx.registration.updateMany.mockResolvedValue({ count: o.count ?? 1 });
    tx.workshop.findUniqueOrThrow.mockResolvedValue({ status: o.workshopStatus ?? 'SCHEDULED' });
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
      strings.join('').includes('WAITLISTED')
        ? o.next === null || o.next === undefined
          ? []
          : [{ id: o.next }]
        : [],
    );
    tx.registration.update.mockImplementation(async ({ where }) => ({ id: where.id }));
  };

  it('404 for unknown registration', async () => {
    const { svc, tx } = setup();
    tx.registration.findUnique.mockResolvedValue(null);
    await expectAppError(svc.cancel('a', 'r1'), 404, 'REGISTRATION_NOT_FOUND');
  });

  it('cancelling an already-cancelled registration -> ALREADY_CANCELLED, no side effects', async () => {
    const { svc, tx } = setup();
    prime(tx, { before: { status: 'CANCELLED' }, count: 0 });
    await expectAppError(svc.cancel('a', 'r1'), 409, 'ALREADY_CANCELLED');
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.workshop.updateMany).not.toHaveBeenCalled();
  });

  it('cancelling twice: second call fails after the first succeeds', async () => {
    const { svc, tx } = setup();
    prime(tx, { next: null });
    await svc.cancel('a', 'r1');
    prime(tx, { before: { status: 'CANCELLED' }, count: 0 });
    await expectAppError(svc.cancel('a', 'r1'), 409, 'ALREADY_CANCELLED');
  });

  it('active cancel with a waitlist promotes the oldest and keeps activeCount', async () => {
    const { svc, tx } = setup();
    prime(tx, { next: 'r-wait' });
    const out = await svc.cancel('actor', 'r1', '  moved  ');
    expect(out.status).toBe('CANCELLED');
    expect(tx.registration.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'CANCELLED',
      cancelledById: 'actor',
      cancelReason: 'moved',
    });
    expect(tx.registration.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'r-wait' },
      data: { status: 'ACTIVE' },
    });
    expect(tx.workshop.updateMany).not.toHaveBeenCalled();
    expect(auditActions(tx)).toEqual(['REGISTRATION_CANCELLED', 'REGISTRATION_PROMOTED']);
  });

  it('active cancel with empty waitlist decrements (guarded > 0)', async () => {
    const { svc, tx } = setup();
    prime(tx, { next: null });
    await svc.cancel('a', 'r1', '   ');
    expect(tx.workshop.updateMany).toHaveBeenCalledWith({
      where: { id: 'w1', activeCount: { gt: 0 } },
      data: { activeCount: { decrement: 1 } },
    });
    expect(tx.registration.updateMany.mock.calls[0][0].data.cancelReason).toBeNull();
  });

  it('active cancel on a non-SCHEDULED workshop frees the seat without promoting', async () => {
    const { svc, tx } = setup();
    prime(tx, { workshopStatus: 'CANCELLED', next: 'r-wait' });
    await svc.cancel('a', 'r1');
    expect(tx.registration.update).not.toHaveBeenCalled();
    expect(tx.workshop.updateMany).toHaveBeenCalledTimes(1);
  });

  it('cancelling a waitlisted registration leaves seat accounting alone', async () => {
    const { svc, tx } = setup();
    prime(tx, { before: { status: 'WAITLISTED' }, next: 'r-other' });
    await svc.cancel('a', 'r1');
    expect(tx.workshop.updateMany).not.toHaveBeenCalled();
    expect(tx.registration.update).not.toHaveBeenCalled();
    expect(auditActions(tx)).toEqual(['REGISTRATION_CANCELLED']);
  });
});

describe('waitlist helpers', () => {
  it('lockNextWaitlisted returns the first id or null', async () => {
    const tx = { $queryRaw: vi.fn() };
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'x' }]).mockResolvedValueOnce([]);
    expect(await lockNextWaitlisted(tx as never, 'w1')).toBe('x');
    expect(await lockNextWaitlisted(tx as never, 'w1')).toBeNull();
  });

  it('activate sets ACTIVE + promotedAt and audits as the actor', async () => {
    const tx = {
      registration: { update: vi.fn().mockResolvedValue({ id: 'r1' }) },
      auditLog: { create: vi.fn() },
    };
    await activate(tx as never, 'r1', 'actor');
    const data = tx.registration.update.mock.calls[0][0].data;
    expect(data.status).toBe('ACTIVE');
    expect(data.promotedAt).toBeInstanceOf(Date);
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'REGISTRATION_PROMOTED',
      actorId: 'actor',
      entityId: 'r1',
    });
  });
});
