import { describe, expect, it, vi } from 'vitest';
import { expectAppError } from '../test-utils.js';
import { WorkshopsService } from './workshops.service.js';

const CAP = Symbol('capacityField');
const ws = (o: Record<string, unknown> = {}) => ({
  id: 'w1',
  code: 'WS1',
  capacity: 10,
  activeCount: 4,
  status: 'SCHEDULED',
  startsAt: new Date('2030-01-01T10:00:00Z'),
  endsAt: new Date('2030-01-01T12:00:00Z'),
  ...o,
});

function setup() {
  const tx = {
    workshop: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    registration: { update: vi.fn() },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
  };
  const prisma = {
    $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    workshop: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      fields: { capacity: CAP },
    },
  };
  return { tx, prisma, svc: new WorkshopsService(prisma as never) };
}

const whereOf = (prisma: ReturnType<typeof setup>['prisma']) =>
  prisma.workshop.findMany.mock.calls[0][0].where.AND;

describe('WorkshopsService.list / get', () => {
  it('no filters -> empty AND, ordered by start', async () => {
    const { svc, prisma } = setup();
    await svc.list({});
    expect(prisma.workshop.findMany).toHaveBeenCalledWith({
      where: { AND: [] },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('builds clauses for date range, status, hasSeats, location and q', async () => {
    const { svc, prisma } = setup();
    const from = new Date('2030-01-01');
    const to = new Date('2030-02-01');
    await svc.list({ from, to, status: 'COMPLETED', hasSeats: true, location: 'Room A', q: 'ts' });
    const and = whereOf(prisma);
    expect(and).toContainEqual({ startsAt: { gte: from, lte: to } });
    expect(and).toContainEqual({ status: 'COMPLETED' });
    expect(and).toContainEqual({ status: 'SCHEDULED', activeCount: { lt: CAP } });
    expect(and).toContainEqual({ location: { equals: 'Room A', mode: 'insensitive' } });
    const ci = { contains: 'ts', mode: 'insensitive' };
    expect(and).toContainEqual({
      OR: [{ title: ci }, { code: ci }, { instructor: ci }, { description: ci }],
    });
    expect(and).toHaveLength(5);
  });

  it('supports an open-ended date range', async () => {
    const { svc, prisma } = setup();
    const from = new Date('2030-01-01');
    await svc.list({ from });
    expect(whereOf(prisma)).toEqual([{ startsAt: { gte: from, lte: undefined } }]);
  });

  it('hasSeats=false adds no seat clause', async () => {
    const { svc, prisma } = setup();
    await svc.list({ hasSeats: false });
    expect(whereOf(prisma)).toEqual([]);
  });

  it('computes seatsLeft and clamps at zero', async () => {
    const { svc, prisma } = setup();
    prisma.workshop.findMany.mockResolvedValue([
      ws({ capacity: 10, activeCount: 4 }),
      ws({ capacity: 5, activeCount: 5 }),
      ws({ capacity: 3, activeCount: 7 }),
    ]);
    const out = await svc.list({});
    expect(out.map((w) => w.seatsLeft)).toEqual([6, 0, 0]);
  });

  it('get returns seatsLeft or 404', async () => {
    const { svc, prisma } = setup();
    prisma.workshop.findUnique.mockResolvedValueOnce(ws());
    expect((await svc.get('w1')).seatsLeft).toBe(6);
    prisma.workshop.findUnique.mockResolvedValueOnce(null);
    await expectAppError(svc.get('nope'), 404, 'WORKSHOP_NOT_FOUND');
  });
});

describe('WorkshopsService.create', () => {
  const input = {
    code: ' ab-1 ',
    title: 'T',
    instructor: 'I',
    location: 'L',
    startsAt: new Date('2030-01-01T10:00:00Z'),
    endsAt: new Date('2030-01-01T11:00:00Z'),
    capacity: 5,
  };

  it('rejects end <= start with INVALID_DATES before touching the db', async () => {
    const { svc, prisma } = setup();
    await expectAppError(
      svc.create('a', { ...input, endsAt: input.startsAt }),
      400,
      'INVALID_DATES',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('upper-cases code, records creator and writes an audit row', async () => {
    const { svc, tx } = setup();
    tx.workshop.create.mockImplementation(async ({ data }) => ws({ ...data, capacity: 5, activeCount: 0 }));
    const out = await svc.create('actor', input);
    expect(tx.workshop.create.mock.calls[0][0].data).toMatchObject({
      code: 'AB-1',
      createdById: 'actor',
      updatedById: 'actor',
    });
    expect(out.seatsLeft).toBe(5);
    expect(tx.auditLog.create.mock.calls[0][0].data.action).toBe('WORKSHOP_CREATED');
  });

  it('maps duplicate code to CODE_TAKEN, rethrows others', async () => {
    const { svc, tx } = setup();
    tx.workshop.create.mockRejectedValueOnce({ code: 'P2002' });
    await expectAppError(svc.create('a', input), 409, 'CODE_TAKEN');
    const boom = new Error('x');
    tx.workshop.create.mockRejectedValueOnce(boom);
    await expect(svc.create('a', input)).rejects.toBe(boom);
  });
});

describe('WorkshopsService.update', () => {
  it('404 when missing', async () => {
    const { svc, tx } = setup();
    tx.workshop.findUnique.mockResolvedValue(null);
    await expectAppError(svc.update('a', 'w1', {}), 404, 'WORKSHOP_NOT_FOUND');
  });

  it('validates dates against the stored values when only one is sent', async () => {
    const { svc, tx } = setup();
    tx.workshop.findUnique.mockResolvedValue(ws());
    await expectAppError(
      svc.update('a', 'w1', { endsAt: new Date('2029-01-01') }),
      400,
      'INVALID_DATES',
    );
  });

  it('CAPACITY_BELOW_REGISTERED when guarded update matches nothing', async () => {
    const { svc, tx } = setup();
    tx.workshop.findUnique.mockResolvedValue(ws({ activeCount: 8 }));
    tx.workshop.updateMany.mockResolvedValue({ count: 0 });
    await expectAppError(
      svc.update('a', 'w1', { capacity: 5 }),
      409,
      'CAPACITY_BELOW_REGISTERED',
    );
    expect(tx.workshop.updateMany.mock.calls[0][0].where).toEqual({
      id: 'w1',
      activeCount: { lte: 5 },
    });
  });

  it('does not guard on activeCount when capacity is not being changed', async () => {
    const { svc, tx } = setup();
    tx.workshop.findUnique.mockResolvedValue(ws());
    tx.workshop.updateMany.mockResolvedValue({ count: 1 });
    tx.workshop.findUniqueOrThrow.mockResolvedValue(ws({ title: 'New' }));
    await svc.update('a', 'w1', { title: 'New' });
    expect(tx.workshop.updateMany.mock.calls[0][0].where).toEqual({ id: 'w1' });
    expect(tx.auditLog.create.mock.calls[0][0].data.action).toBe('WORKSHOP_UPDATED');
  });

  it('audits a status change as WORKSHOP_<STATUS>', async () => {
    const { svc, tx } = setup();
    tx.workshop.findUnique.mockResolvedValue(ws());
    tx.workshop.updateMany.mockResolvedValue({ count: 1 });
    tx.workshop.findUniqueOrThrow.mockResolvedValue(ws({ status: 'CANCELLED' }));
    await svc.update('a', 'w1', { status: 'CANCELLED' });
    expect(tx.auditLog.create.mock.calls[0][0].data.action).toBe('WORKSHOP_CANCELLED');
  });

  it('maps a code collision on update to CODE_TAKEN', async () => {
    const { svc, tx } = setup();
    tx.workshop.findUnique.mockResolvedValue(ws());
    tx.workshop.updateMany.mockRejectedValue({ code: 'P2002' });
    await expectAppError(svc.update('a', 'w1', { code: 'x' }), 409, 'CODE_TAKEN');
  });

  describe('capacity growth promotes the waitlist', () => {
    const grow = (waitlist: string[], before: object, after: object) => {
      const h = setup();
      h.tx.workshop.findUnique.mockResolvedValue(ws(before));
      h.tx.workshop.updateMany.mockResolvedValue({ count: 1 });
      h.tx.workshop.findUniqueOrThrow.mockResolvedValue(ws(after));
      const queue = [...waitlist];
      h.tx.$queryRaw.mockImplementation(async () => (queue.length ? [{ id: queue.shift() }] : []));
      h.tx.registration.update.mockImplementation(async ({ where }) => ({ id: where.id }));
      h.tx.workshop.update.mockImplementation(async ({ data }) =>
        ws({ ...after, activeCount: (after as { activeCount: number }).activeCount + data.activeCount.increment }),
      );
      return h;
    };
    const promotedIds = (tx: ReturnType<typeof setup>['tx']) =>
      tx.registration.update.mock.calls.map((c) => c[0].where.id);

    it('promotes only as many as new seats allow', async () => {
      const { svc, tx } = grow(['r1', 'r2', 'r3', 'r4'], { capacity: 5, activeCount: 5 }, { capacity: 7, activeCount: 5 });
      const out = await svc.update('a', 'w1', { capacity: 7 });
      expect(promotedIds(tx)).toEqual(['r1', 'r2']);
      expect(tx.workshop.update.mock.calls[0][0].data).toEqual({ activeCount: { increment: 2 } });
      expect(out.activeCount).toBe(7);
      expect(out.seatsLeft).toBe(0);
      const actions = tx.auditLog.create.mock.calls.map((c) => c[0].data.action);
      expect(actions.filter((a) => a === 'REGISTRATION_PROMOTED')).toHaveLength(2);
    });

    it('stops when the waitlist runs out', async () => {
      const { svc, tx } = grow(['r1'], { capacity: 5, activeCount: 5 }, { capacity: 9, activeCount: 5 });
      const out = await svc.update('a', 'w1', { capacity: 9 });
      expect(promotedIds(tx)).toEqual(['r1']);
      expect(out.seatsLeft).toBe(3);
    });

    it('does not touch activeCount when nobody is waitlisted', async () => {
      const { svc, tx } = grow([], { capacity: 5, activeCount: 5 }, { capacity: 9, activeCount: 5 });
      await svc.update('a', 'w1', { capacity: 9 });
      expect(tx.workshop.update).not.toHaveBeenCalled();
    });

    it('does not promote when the workshop is not SCHEDULED', async () => {
      const { svc, tx } = grow(['r1'], { capacity: 5, activeCount: 5 }, { capacity: 9, activeCount: 5, status: 'CANCELLED' });
      await svc.update('a', 'w1', { capacity: 9 });
      expect(tx.registration.update).not.toHaveBeenCalled();
    });

    it('does not promote when capacity shrinks or stays', async () => {
      const { svc, tx } = grow(['r1'], { capacity: 9, activeCount: 2 }, { capacity: 6, activeCount: 2 });
      await svc.update('a', 'w1', { capacity: 6 });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
