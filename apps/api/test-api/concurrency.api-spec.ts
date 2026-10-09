import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type App, client, createApp, loginAll, register, scratchWorkshop, uid,
} from './helpers.ts';

type Reg = { id: string; status: string; attendeeEmail: string };

describe('concurrency', () => {
  let app: App;
  let call: ReturnType<typeof client>;
  let tokens: Awaited<ReturnType<typeof loginAll>>;

  beforeAll(async () => {
    app = await createApp();
    call = client(app);
    tokens = await loginAll(app);
  });
  afterAll(() => app.close());

  const snapshot = async (id: string) => {
    const w = (await call('get', `/workshops/${id}`, tokens.staff)).body;
    const list = (await call('get', `/workshops/${id}/registrations`, tokens.staff)).body as Reg[];
    const count = (s: string) => list.filter((r) => r.status === s).length;
    return { w, list, active: count('ACTIVE'), waitlisted: count('WAITLISTED'), cancelled: count('CANCELLED') };
  };

  it('30 parallel registrations on a 5-seat workshop admit exactly 5', async () => {
    const w = await scratchWorkshop(app, tokens.manager, 5);
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => register(app, i % 2 ? tokens.staff : tokens.manager, w.id, `p${i}-${uid()}`)),
    );
    const created = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);
    expect(created).toHaveLength(5);
    expect(rejected).toHaveLength(25);
    for (const r of rejected) expect(r.body.code).toBe('WORKSHOP_FULL');
    expect(results.filter((r) => ![201, 409].includes(r.status))).toHaveLength(0);

    const s = await snapshot(w.id);
    expect(s.w).toMatchObject({ activeCount: 5, seatsLeft: 0 });
    expect(s.active).toBe(5);
    expect(s.list).toHaveLength(5);
  });

  it('30 parallel registrations with the waitlist flag: 5 ACTIVE, 25 WAITLISTED', async () => {
    const w = await scratchWorkshop(app, tokens.manager, 5);
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => register(app, tokens.staff, w.id, `p${i}-${uid()}`, true)),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(results.filter((r) => r.body.status === 'ACTIVE')).toHaveLength(5);
    expect(results.filter((r) => r.body.status === 'WAITLISTED')).toHaveLength(25);
    const s = await snapshot(w.id);
    expect(s).toMatchObject({ active: 5, waitlisted: 25 });
    expect(s.w.activeCount).toBe(5);
  });

  it('parallel registrations of the same attendee yield exactly one success', async () => {
    const w = await scratchWorkshop(app, tokens.manager, 10);
    const tag = uid();
    const results = await Promise.all(Array.from({ length: 10 }, () => register(app, tokens.staff, w.id, tag)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const dups = results.filter((r) => r.status === 409);
    expect(dups).toHaveLength(9);
    for (const r of dups) expect(r.body.code).toBe('ALREADY_REGISTERED');
    const s = await snapshot(w.id);
    expect(s.w.activeCount).toBe(1);
    expect(s.list).toHaveLength(1);
  });

  it('parallel cancels of different active registrations promote exactly that many waiters', async () => {
    const w = await scratchWorkshop(app, tokens.manager, 5);
    const active: Reg[] = [];
    for (let i = 0; i < 5; i++) active.push((await register(app, tokens.staff, w.id, `a${i}-${uid()}`)).body);
    for (let i = 0; i < 10; i++) await register(app, tokens.staff, w.id, `w${i}-${uid()}`, true);

    const results = await Promise.all(
      active.map((r) => call('post', `/registrations/${r.id}/cancel`, tokens.staff, {})),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);

    const s = await snapshot(w.id);
    expect(s.w.activeCount).toBe(5);
    expect(s).toMatchObject({ active: 5, waitlisted: 5, cancelled: 5 });
    const originals = new Set(active.map((r) => r.id));
    expect(s.list.filter((r) => r.status === 'ACTIVE' && originals.has(r.id))).toHaveLength(0);
  });

  it('promotions follow waitlist order even when cancels race', async () => {
    const w = await scratchWorkshop(app, tokens.manager, 3);
    const active: Reg[] = [];
    for (let i = 0; i < 3; i++) active.push((await register(app, tokens.staff, w.id, `a${i}-${uid()}`)).body);
    const waiters: Reg[] = [];
    for (let i = 0; i < 6; i++) waiters.push((await register(app, tokens.staff, w.id, `w${i}-${uid()}`, true)).body);

    await Promise.all(active.map((r) => call('post', `/registrations/${r.id}/cancel`, tokens.staff, {})));
    const s = await snapshot(w.id);
    const byId = Object.fromEntries(s.list.map((r) => [r.id, r.status]));
    expect(waiters.slice(0, 3).map((r) => byId[r.id])).toEqual(['ACTIVE', 'ACTIVE', 'ACTIVE']);
    expect(waiters.slice(3).map((r) => byId[r.id])).toEqual(['WAITLISTED', 'WAITLISTED', 'WAITLISTED']);
  });

  it('parallel cancels without a waitlist release exactly the cancelled seats', async () => {
    const w = await scratchWorkshop(app, tokens.manager, 8);
    const regs: Reg[] = [];
    for (let i = 0; i < 8; i++) regs.push((await register(app, tokens.staff, w.id, `a${i}-${uid()}`)).body);
    const results = await Promise.all(
      regs.slice(0, 5).map((r) => call('post', `/registrations/${r.id}/cancel`, tokens.staff, {})),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const s = await snapshot(w.id);
    expect(s.w).toMatchObject({ activeCount: 3, seatsLeft: 5 });
    expect(s).toMatchObject({ active: 3, cancelled: 5 });
  });

  it('10 parallel cancels of the SAME registration: one 200, nine ALREADY_CANCELLED, one seat released', async () => {
    const w = await scratchWorkshop(app, tokens.manager, 4);
    const target: Reg = (await register(app, tokens.staff, w.id, `t-${uid()}`)).body;
    await register(app, tokens.staff, w.id, `o1-${uid()}`);
    await register(app, tokens.staff, w.id, `o2-${uid()}`);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => call('post', `/registrations/${target.id}/cancel`, tokens.staff, {})),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const dups = results.filter((r) => r.status === 409);
    expect(dups).toHaveLength(9);
    for (const r of dups) expect(r.body.code).toBe('ALREADY_CANCELLED');
    expect((await snapshot(w.id)).w.activeCount).toBe(2);
  });

  it('same-registration parallel cancels promote only one waiter', async () => {
    const w = await scratchWorkshop(app, tokens.manager, 1);
    const target: Reg = (await register(app, tokens.staff, w.id, `t-${uid()}`)).body;
    for (let i = 0; i < 3; i++) await register(app, tokens.staff, w.id, `w${i}-${uid()}`, true);
    await Promise.all(Array.from({ length: 6 }, () => call('post', `/registrations/${target.id}/cancel`, tokens.staff, {})));
    const s = await snapshot(w.id);
    expect(s.w.activeCount).toBe(1);
    expect(s).toMatchObject({ active: 1, waitlisted: 2, cancelled: 1 });
  });

  it('mixed registers and cancels never exceed capacity and keep activeCount exact', async () => {
    const w = await scratchWorkshop(app, tokens.manager, 5);
    const seeded: Reg[] = [];
    for (let i = 0; i < 5; i++) seeded.push((await register(app, tokens.staff, w.id, `s${i}-${uid()}`)).body);

    const ops = [
      ...seeded.slice(0, 3).map((r) => call('post', `/registrations/${r.id}/cancel`, tokens.staff, {})),
      ...Array.from({ length: 20 }, (_, i) => register(app, tokens.staff, w.id, `m${i}-${uid()}`, i % 2 === 0)),
    ];
    const results = await Promise.all(ops);
    expect(results.filter((r) => r.status >= 500)).toHaveLength(0);

    const s = await snapshot(w.id);
    expect(s.active).toBeLessThanOrEqual(5);
    expect(s.w.activeCount).toBe(s.active);
    expect(s.active).toBe(5);
  });

  it('parallel registers racing a capacity increase stay consistent', async () => {
    const w = await scratchWorkshop(app, tokens.manager, 2);
    const ops = [
      call('patch', `/workshops/${w.id}`, tokens.manager, { capacity: 6 }),
      ...Array.from({ length: 12 }, (_, i) => register(app, tokens.staff, w.id, `r${i}-${uid()}`, true)),
    ];
    const results = await Promise.all(ops);
    expect(results.filter((r) => r.status >= 500)).toHaveLength(0);
    const s = await snapshot(w.id);
    expect(s.w.capacity).toBe(6);
    expect(s.w.activeCount).toBe(s.active);
    expect(s.active).toBe(6);
    expect(s.waitlisted).toBe(6);
  });

  it('parallel capacity shrink vs registers never leaves activeCount above capacity', async () => {
    const w = await scratchWorkshop(app, tokens.manager, 10);
    const ops = [
      call('patch', `/workshops/${w.id}`, tokens.manager, { capacity: 3 }),
      ...Array.from({ length: 10 }, (_, i) => register(app, tokens.staff, w.id, `r${i}-${uid()}`, true)),
    ];
    const results = await Promise.all(ops);
    expect(results.filter((r) => r.status >= 500)).toHaveLength(0);
    const s = await snapshot(w.id);
    expect(s.w.activeCount).toBe(s.active);
    expect(s.w.activeCount).toBeLessThanOrEqual(s.w.capacity);
  });
});
