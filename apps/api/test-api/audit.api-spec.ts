import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS } from './fixtures.ts';
import {
  type App, ISO_RE, client, createApp, expectError, loginAll, register, scratchWorkshop, uid,
} from './helpers.ts';

interface AuditItem {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
  actor: { id: string; name: string; email: string };
}

describe('GET /audit', () => {
  let app: App;
  let call: ReturnType<typeof client>;
  let tokens: Awaited<ReturnType<typeof loginAll>>;

  beforeAll(async () => {
    app = await createApp();
    call = client(app);
    tokens = await loginAll(app);
  });
  afterAll(() => app.close());

  const page = async (token: string, query = '') => {
    const res = await call('get', `/audit${query}`, token);
    expect(res.status).toBe(200);
    return res.body as { items: AuditItem[]; total: number; page: number; pageSize: number };
  };

  it('returns the documented envelope and item shape', async () => {
    const body = await page(tokens.manager);
    expect(Object.keys(body).sort()).toEqual(['items', 'page', 'pageSize', 'total']);
    expect(body).toMatchObject({ page: 1, pageSize: 25 });
    expect(body.items.length).toBeGreaterThan(0);
    for (const i of body.items) {
      expect(Object.keys(i).sort()).toEqual([
        'action', 'actor', 'actorId', 'after', 'before', 'createdAt', 'entityId', 'entityType', 'id',
      ]);
      expect(typeof i.id).toBe('string');
      expect(i.id).toMatch(/^\d+$/);
      expect(i.createdAt).toMatch(ISO_RE);
      expect(Object.keys(i.actor).sort()).toEqual(['email', 'id', 'name']);
    }
  });

  it('orders newest first (descending id)', async () => {
    const { items } = await page(tokens.manager, '?pageSize=100');
    const ids = items.map((i) => BigInt(i.id));
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
  });

  describe('visibility by role', () => {
    it('admin sees only account (USER) events', async () => {
      const { items, total } = await page(tokens.admin, '?pageSize=100');
      expect(total).toBeGreaterThanOrEqual(2);
      expect(items.every((i) => i.entityType === 'USER')).toBe(true);
      expect(items.map((i) => i.action)).toContain('USER_CREATED');
    });

    it.each(['manager', 'staff'] as const)('%s sees only workshop and registration events', async (role) => {
      const { items, total } = await page(tokens[role], '?pageSize=100');
      expect(total).toBeGreaterThanOrEqual(9);
      expect(items.every((i) => ['WORKSHOP', 'REGISTRATION'].includes(i.entityType))).toBe(true);
    });

    it('manager and staff see the same stream', async () => {
      const m = await page(tokens.manager, '?pageSize=10');
      const s = await page(tokens.staff, '?pageSize=10');
      expect(m.items.map((i) => i.id)).toEqual(s.items.map((i) => i.id));
      expect(m.total).toBe(s.total);
    });

    it('includes the seeded fixture entries', async () => {
      const { items } = await page(tokens.admin, '?pageSize=100');
      expect(items.filter((i) => i.action === 'USER_CREATED' && i.actorId === USERS.admin.id).length)
        .toBeGreaterThanOrEqual(2);
    });
  });

  describe('events are recorded for actions', () => {
    it('USER_CREATED appears for admins after creating a user', async () => {
      const before = (await page(tokens.admin)).total;
      const created = await call('post', '/users', tokens.admin, {
        email: `u-${uid()}@test.local`, name: 'Audited', password: 'Sup3rSecret!', role: 'STAFF',
      });
      const after = await page(tokens.admin);
      expect(after.total).toBe(before + 1);
      expect(after.items[0]).toMatchObject({
        action: 'USER_CREATED',
        entityType: 'USER',
        entityId: created.body.id,
        actorId: USERS.admin.id,
        actor: { id: USERS.admin.id, email: USERS.admin.email, name: USERS.admin.name },
        before: null,
      });
      expect(JSON.stringify(after.items[0].after)).not.toMatch(/passwordHash/i);
    });

    it('user events never leak into the manager stream', async () => {
      const tag = uid();
      const created = await call('post', '/users', tokens.admin, {
        email: `u-${tag}@test.local`, name: 'Hidden', password: 'Sup3rSecret!', role: 'STAFF',
      });
      const { items } = await page(tokens.manager, '?pageSize=100');
      expect(items.find((i) => i.entityId === created.body.id)).toBeUndefined();
    });

    it('workshop and registration lifecycle is logged in order', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 1);
      const a = (await register(app, tokens.staff, w.id, `a-${uid()}`)).body;
      const b = (await register(app, tokens.staff, w.id, `b-${uid()}`, true)).body;
      await call('post', `/registrations/${a.id}/cancel`, tokens.staff, { reason: 'audit' });
      await call('patch', `/workshops/${w.id}`, tokens.manager, { status: 'COMPLETED' });

      const { items } = await page(tokens.manager, '?pageSize=100');
      const mine = items
        .filter((i) => [w.id, a.id, b.id].includes(i.entityId))
        .reverse()
        .map((i) => `${i.entityType}:${i.action}:${i.entityId === w.id ? 'w' : i.entityId === a.id ? 'a' : 'b'}`);
      expect(mine).toEqual([
        'WORKSHOP:WORKSHOP_CREATED:w',
        'REGISTRATION:REGISTRATION_CREATED:a',
        'REGISTRATION:REGISTRATION_WAITLISTED:b',
        'REGISTRATION:REGISTRATION_CANCELLED:a',
        'REGISTRATION:REGISTRATION_PROMOTED:b',
        'WORKSHOP:WORKSHOP_COMPLETED:w',
      ]);
    });

    it('stores before/after snapshots on cancel', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 2);
      const a = (await register(app, tokens.staff, w.id, `a-${uid()}`)).body;
      await call('post', `/registrations/${a.id}/cancel`, tokens.manager, { reason: 'because' });
      const { items } = await page(tokens.manager, '?pageSize=20');
      const entry = items.find((i) => i.entityId === a.id && i.action === 'REGISTRATION_CANCELLED')!;
      expect(entry.actorId).toBe(USERS.manager.id);
      expect(entry.before).toMatchObject({ status: 'ACTIVE' });
      expect(entry.after).toMatchObject({ status: 'CANCELLED', cancelReason: 'because' });
    });

    it('does not log rejected operations', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 1);
      await register(app, tokens.staff, w.id, `a-${uid()}`);
      const before = (await page(tokens.manager)).total;
      await register(app, tokens.staff, w.id, `b-${uid()}`); // WORKSHOP_FULL
      await call('patch', `/workshops/${w.id}`, tokens.manager, { capacity: 1, code: 'X'.repeat(31) }); // 400
      expect((await page(tokens.manager)).total).toBe(before);
    });
  });

  describe('pagination', () => {
    it('honours pageSize and page, with stable totals', async () => {
      const first = await page(tokens.manager, '?page=1&pageSize=3');
      const second = await page(tokens.manager, '?page=2&pageSize=3');
      expect(first.items).toHaveLength(3);
      expect(second.items).toHaveLength(3);
      expect(first).toMatchObject({ page: 1, pageSize: 3 });
      expect(second).toMatchObject({ page: 2, pageSize: 3 });
      expect(first.total).toBe(second.total);
      const ids = [...first.items, ...second.items].map((i) => i.id);
      expect(new Set(ids).size).toBe(6);
      expect(BigInt(first.items[2].id)).toBeGreaterThan(BigInt(second.items[0].id));
    });

    it('returns an empty page past the end but keeps the total', async () => {
      const body = await page(tokens.manager, '?page=9999&pageSize=100');
      expect(body.items).toEqual([]);
      expect(body.total).toBeGreaterThan(0);
    });

    it('accepts the maximum page size of 100', async () => {
      const body = await page(tokens.manager, '?pageSize=100');
      expect(body.pageSize).toBe(100);
      expect(body.items.length).toBeLessThanOrEqual(100);
    });

    it('pages cover every item exactly once', async () => {
      const total = (await page(tokens.manager, '?pageSize=100')).total;
      const seen = new Set<string>();
      for (let p = 1; p <= Math.ceil(total / 7); p++) {
        for (const i of (await page(tokens.manager, `?page=${p}&pageSize=7`)).items) seen.add(i.id);
      }
      expect(seen.size).toBe(total);
    });

    it.each([
      ['page=0', 'page=0'],
      ['negative page', 'page=-1'],
      ['non-numeric page', 'page=abc'],
      ['fractional page', 'page=1.5'],
      ['pageSize=0', 'pageSize=0'],
      ['pageSize over 100', 'pageSize=101'],
      ['non-numeric pageSize', 'pageSize=lots'],
    ])('rejects %s with 400', async (_n, q) => {
      expectError(await call('get', `/audit?${q}`, tokens.manager), 400, 'VALIDATION_ERROR');
    });
  });
});
