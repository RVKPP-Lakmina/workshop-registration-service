import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_REGISTRATIONS, REGISTRATIONS, USERS, WORKSHOPS } from './fixtures.ts';
import {
  type App, ISO_RE, NIL_UUID, client, createApp, expectError, loginAll, register, registerBody,
  scratchWorkshop, uid,
} from './helpers.ts';
import { REGISTRATION_KEYS, REGISTRATION_LIST_KEYS, expectRegistrationShape } from './shapes.ts';

type Reg = {
  id: string;
  status: string;
  attendeeEmail: string;
  promotedAt: string | null;
  cancelledById: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
};

describe('registrations', () => {
  let app: App;
  let call: ReturnType<typeof client>;
  let tokens: Awaited<ReturnType<typeof loginAll>>;

  beforeAll(async () => {
    app = await createApp();
    call = client(app);
    tokens = await loginAll(app);
  });
  afterAll(() => app.close());

  const workshop = async (id: string) => (await call('get', `/workshops/${id}`, tokens.staff)).body;
  const regs = async (id: string) =>
    (await call('get', `/workshops/${id}/registrations`, tokens.staff)).body as Reg[];
  const reg = async (workshopId: string, n: string, waitlist = false, token = tokens.staff) => {
    const res = await register(app, token, workshopId, n, waitlist);
    expect(res.status).toBe(201);
    return res.body as Reg;
  };
  const cancel = (id: string, body: object = {}, token = tokens.staff) =>
    call('post', `/registrations/${id}/cancel`, token, body);
  const auditFor = async (entityId: string) => {
    const res = await call('get', '/audit?pageSize=100', tokens.manager);
    return (res.body.items as { entityId: string; action: string }[])
      .filter((a) => a.entityId === entityId)
      .map((a) => a.action);
  };

  describe('GET /workshops/:id/registrations', () => {
    it('lists the full workshop with active and waitlisted people in registration order', async () => {
      const res = await call('get', `/workshops/${WORKSHOPS.full.id}/registrations`, tokens.staff);
      expect(res.status).toBe(200);
      expect(res.body.map((r: Reg) => [r.id, r.status])).toEqual([
        [REGISTRATIONS.fullF1.id, 'ACTIVE'],
        [REGISTRATIONS.fullF2.id, 'ACTIVE'],
        [REGISTRATIONS.fullF3.id, 'ACTIVE'],
        [REGISTRATIONS.fullW1.id, 'WAITLISTED'],
        [REGISTRATIONS.fullW2.id, 'WAITLISTED'],
      ]);
    });

    it('returns the documented shape including registeredBy / cancelledBy summaries', async () => {
      const res = await call('get', `/workshops/${WORKSHOPS.full.id}/registrations`, tokens.manager);
      for (const r of res.body) expectRegistrationShape(r, REGISTRATION_LIST_KEYS);
      const f3 = res.body.find((r: Reg) => r.id === REGISTRATIONS.fullF3.id);
      expect(f3).toMatchObject({
        attendeeName: 'Hal Third',
        attendeeEmail: REGISTRATIONS.fullF3.email,
        registeredById: USERS.manager.id,
        registeredBy: { id: USERS.manager.id, name: USERS.manager.name },
        cancelledBy: null,
        cancelledAt: null,
        cancelReason: null,
        promotedAt: null,
      });
    });

    it('includes cancelled registrations with who cancelled and why', async () => {
      const list = await regs(WORKSHOPS.open.id);
      expect(list.map((r) => r.status)).toEqual(['ACTIVE', 'ACTIVE', 'CANCELLED']);
      const carl = list.find((r) => r.id === REGISTRATIONS.openCarl.id) as Reg & { cancelledBy: unknown };
      expect(carl).toMatchObject({
        cancelledById: USERS.staff.id,
        cancelledBy: { id: USERS.staff.id, name: USERS.staff.name },
        cancelReason: 'Changed plans',
      });
      expect(carl.cancelledAt).toMatch(ISO_RE);
    });

    it('returns an empty array for a workshop with no registrations', async () => {
      const res = await call('get', `/workshops/${WORKSHOPS.empty.id}/registrations`, tokens.staff);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('matches the seeded counts for every fixture workshop', async () => {
      for (const w of Object.values(WORKSHOPS)) {
        const list = await regs(w.id);
        const expected = ALL_REGISTRATIONS.filter((r) => WORKSHOPS[r.workshop].id === w.id);
        expect(list).toHaveLength(expected.length);
        expect(list.filter((r) => r.status === 'ACTIVE')).toHaveLength(w.activeCount);
      }
    });

    it('returns 404 WORKSHOP_NOT_FOUND for an unknown workshop', async () => {
      expectError(await call('get', `/workshops/${NIL_UUID}/registrations`, tokens.staff), 404, 'WORKSHOP_NOT_FOUND');
    });

    it('returns 400 for a malformed workshop id', async () => {
      expectError(await call('get', '/workshops/abc/registrations', tokens.staff), 400, 'BAD_REQUEST');
    });
  });

  describe('POST /workshops/:id/registrations', () => {
    it('registers an attendee (201) and consumes a seat', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 3);
      const res = await register(app, tokens.staff, w.id, `ok-${uid()}`);
      expect(res.status).toBe(201);
      expectRegistrationShape(res.body, REGISTRATION_KEYS);
      expect(res.body).toMatchObject({
        workshopId: w.id,
        status: 'ACTIVE',
        registeredById: USERS.staff.id,
        cancelledById: null,
        cancelledAt: null,
        cancelReason: null,
        promotedAt: null,
      });
      expect(await workshop(w.id)).toMatchObject({ activeCount: 1, seatsLeft: 2 });
      expect(await auditFor(res.body.id)).toEqual(['REGISTRATION_CREATED']);
    });

    it('lets a manager register too and records them as the registrar', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 3);
      const r = await reg(w.id, `m-${uid()}`, false, tokens.manager);
      expect(r).toMatchObject({ status: 'ACTIVE' });
      expect((await regs(w.id))[0]).toMatchObject({ registeredBy: { id: USERS.manager.id } });
    });

    it('trims the name and lower-cases the email', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 3);
      const tag = uid();
      const res = await call('post', `/workshops/${w.id}/registrations`, tokens.staff, {
        attendeeName: '  Padded Person  ',
        attendeeEmail: `Mixed.${tag}@Example.COM`,
      });
      expect(res.status).toBe(201);
      expect(res.body.attendeeName).toBe('Padded Person');
      expect(res.body.attendeeEmail).toBe(`mixed.${tag}@example.com`);
    });

    it('takes the last seat, then returns 409 WORKSHOP_FULL', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 1);
      await reg(w.id, `a-${uid()}`);
      expectError(await register(app, tokens.staff, w.id, `b-${uid()}`), 409, 'WORKSHOP_FULL');
      expect(await workshop(w.id)).toMatchObject({ activeCount: 1, seatsLeft: 0 });
      expect(await regs(w.id)).toHaveLength(1);
    });

    it('returns 409 WORKSHOP_FULL for the seeded full workshop and changes nothing', async () => {
      expectError(await register(app, tokens.staff, WORKSHOPS.full.id, `x-${uid()}`), 409, 'WORKSHOP_FULL');
      expect(await workshop(WORKSHOPS.full.id)).toMatchObject({ activeCount: 3 });
      expect(await regs(WORKSHOPS.full.id)).toHaveLength(5);
    });

    it('joins the waitlist when full and joinWaitlistIfFull is true', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 1);
      await reg(w.id, `a-${uid()}`);
      const res = await register(app, tokens.staff, w.id, `b-${uid()}`, true);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('WAITLISTED');
      expect(await workshop(w.id)).toMatchObject({ activeCount: 1, seatsLeft: 0 });
      expect(await auditFor(res.body.id)).toEqual(['REGISTRATION_WAITLISTED']);
    });

    it('ignores joinWaitlistIfFull when seats are free (registers ACTIVE)', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 2);
      const r = await reg(w.id, `a-${uid()}`, true);
      expect(r.status).toBe('ACTIVE');
    });

    it('keeps adding to the waitlist beyond capacity', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 1);
      await reg(w.id, `a-${uid()}`);
      for (let i = 0; i < 3; i++) expect((await reg(w.id, `w${i}-${uid()}`, true)).status).toBe('WAITLISTED');
      expect((await regs(w.id)).map((r) => r.status)).toEqual(['ACTIVE', 'WAITLISTED', 'WAITLISTED', 'WAITLISTED']);
    });

    it('returns 409 ALREADY_REGISTERED for the same email, case-insensitively', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 5);
      const tag = uid();
      await reg(w.id, tag);
      expectError(await register(app, tokens.staff, w.id, tag), 409, 'ALREADY_REGISTERED');
      const upper = await call('post', `/workshops/${w.id}/registrations`, tokens.staff, {
        attendeeName: 'Other Name',
        attendeeEmail: `ATTENDEE${tag}@EXAMPLE.COM`,
      });
      expectError(upper, 409, 'ALREADY_REGISTERED');
      expect(await workshop(w.id)).toMatchObject({ activeCount: 1 });
    });

    it('returns 409 ALREADY_REGISTERED for an attendee who is already waitlisted', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 1);
      await reg(w.id, `a-${uid()}`);
      const tag = uid();
      await reg(w.id, tag, true);
      expectError(await register(app, tokens.staff, w.id, tag, true), 409, 'ALREADY_REGISTERED');
    });

    it('does not leak a seat when a duplicate is rejected (seeded workshop)', async () => {
      const dup = await call('post', `/workshops/${WORKSHOPS.open.id}/registrations`, tokens.staff, {
        attendeeName: 'Ada Again',
        attendeeEmail: REGISTRATIONS.openAda.email,
      });
      expectError(dup, 409, 'ALREADY_REGISTERED');
      expect(await workshop(WORKSHOPS.open.id)).toMatchObject({ activeCount: 2 });
    });

    it('allows the same email on different workshops', async () => {
      const a = await scratchWorkshop(app, tokens.manager, 2);
      const b = await scratchWorkshop(app, tokens.manager, 2);
      const tag = uid();
      await reg(a.id, tag);
      await reg(b.id, tag);
    });

    it('allows re-registering after the earlier registration was cancelled', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 2);
      const tag = uid();
      const first = await reg(w.id, tag);
      expect((await cancel(first.id)).status).toBe(200);
      const again = await reg(w.id, tag);
      expect(again.id).not.toBe(first.id);
      expect(await workshop(w.id)).toMatchObject({ activeCount: 1 });
    });

    it('returns 409 WORKSHOP_NOT_OPEN for a cancelled workshop (even with waitlist)', async () => {
      expectError(await register(app, tokens.staff, WORKSHOPS.cancelled.id, `n-${uid()}`), 409, 'WORKSHOP_NOT_OPEN');
      expectError(await register(app, tokens.staff, WORKSHOPS.cancelled.id, `n-${uid()}`, true), 409, 'WORKSHOP_NOT_OPEN');
    });

    it('returns 409 WORKSHOP_NOT_OPEN for a completed workshop', async () => {
      expectError(await register(app, tokens.staff, WORKSHOPS.completed.id, `n-${uid()}`, true), 409, 'WORKSHOP_NOT_OPEN');
      expect(await workshop(WORKSHOPS.completed.id)).toMatchObject({ activeCount: 4 });
    });

    it('returns 409 WORKSHOP_NOT_OPEN once a manager cancels the workshop', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 3);
      await call('patch', `/workshops/${w.id}`, tokens.manager, { status: 'CANCELLED' });
      expectError(await register(app, tokens.staff, w.id, `n-${uid()}`), 409, 'WORKSHOP_NOT_OPEN');
    });

    it('returns 404 WORKSHOP_NOT_FOUND for an unknown workshop', async () => {
      expectError(await register(app, tokens.staff, NIL_UUID, `n-${uid()}`), 404, 'WORKSHOP_NOT_FOUND');
    });

    it('returns 400 for a malformed workshop id', async () => {
      expect((await register(app, tokens.staff, 'nope', `n-${uid()}`)).status).toBe(400);
    });

    it.each([
      ['missing name', { attendeeName: undefined }],
      ['empty name', { attendeeName: '' }],
      ['name over 120 chars', { attendeeName: 'x'.repeat(121) }],
      ['missing email', { attendeeEmail: undefined }],
      ['malformed email', { attendeeEmail: 'not-an-email' }],
      ['non-boolean joinWaitlistIfFull', { joinWaitlistIfFull: 'yes' }],
      ['numeric name', { attendeeName: 42 }],
    ])('returns 400 VALIDATION_ERROR for %s', async (_n, over) => {
      const w = await scratchWorkshop(app, tokens.manager, 2);
      const res = await call('post', `/workshops/${w.id}/registrations`, tokens.staff, {
        ...registerBody(uid()),
        ...over,
      });
      expectError(res, 400, 'VALIDATION_ERROR');
      expect(await workshop(w.id)).toMatchObject({ activeCount: 0 });
    });

    it('validates the body before checking workshop existence', async () => {
      const res = await call('post', `/workshops/${NIL_UUID}/registrations`, tokens.staff, {});
      expectError(res, 400, 'VALIDATION_ERROR');
    });

    it('ignores client-supplied status and registeredById', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 1);
      await reg(w.id, `a-${uid()}`);
      const res = await call('post', `/workshops/${w.id}/registrations`, tokens.staff, {
        ...registerBody(uid(), true),
        status: 'ACTIVE',
        registeredById: USERS.admin.id,
      });
      expect(res.body).toMatchObject({ status: 'WAITLISTED', registeredById: USERS.staff.id });
    });
  });

  describe('POST /registrations/:id/cancel', () => {
    it('cancels an active registration (200), records who/when/why and frees the seat', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 2);
      const r = await reg(w.id, `a-${uid()}`);
      const res = await cancel(r.id, { reason: '  Sick  ' }, tokens.manager);
      expect(res.status).toBe(200);
      expectRegistrationShape(res.body, REGISTRATION_KEYS);
      expect(res.body).toMatchObject({
        id: r.id,
        status: 'CANCELLED',
        cancelledById: USERS.manager.id,
        cancelReason: 'Sick',
      });
      expect(res.body.cancelledAt).toMatch(ISO_RE);
      expect(await workshop(w.id)).toMatchObject({ activeCount: 0, seatsLeft: 2 });
      expect(await auditFor(r.id)).toEqual(expect.arrayContaining(['REGISTRATION_CREATED', 'REGISTRATION_CANCELLED']));
    });

    it('works without a body reason (null) and with a blank reason', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 3);
      const a = await reg(w.id, `a-${uid()}`);
      const b = await reg(w.id, `b-${uid()}`);
      expect((await cancel(a.id)).body.cancelReason).toBeNull();
      expect((await cancel(b.id, { reason: '   ' })).body.cancelReason).toBeNull();
    });

    it('accepts a 500-char reason and rejects 501', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 3);
      const a = await reg(w.id, `a-${uid()}`);
      const b = await reg(w.id, `b-${uid()}`);
      expectError(await cancel(a.id, { reason: 'x'.repeat(501) }), 400, 'VALIDATION_ERROR');
      expect((await workshop(w.id)).activeCount).toBe(2);
      expect((await cancel(b.id, { reason: 'x'.repeat(500) })).status).toBe(200);
    });

    it('returns 400 for a non-string reason', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 1);
      const a = await reg(w.id, `a-${uid()}`);
      expectError(await cancel(a.id, { reason: 123 }), 400, 'VALIDATION_ERROR');
    });

    it('returns 409 ALREADY_CANCELLED on a second cancel and does not double-decrement', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 3);
      const a = await reg(w.id, `a-${uid()}`);
      await reg(w.id, `b-${uid()}`);
      expect((await cancel(a.id)).status).toBe(200);
      expectError(await cancel(a.id), 409, 'ALREADY_CANCELLED');
      expect((await workshop(w.id)).activeCount).toBe(1);
    });

    it('returns 409 ALREADY_CANCELLED for the seeded cancelled registration', async () => {
      expectError(await cancel(REGISTRATIONS.openCarl.id), 409, 'ALREADY_CANCELLED');
      expect((await workshop(WORKSHOPS.open.id)).activeCount).toBe(2);
    });

    it('returns 404 REGISTRATION_NOT_FOUND for an unknown registration', async () => {
      expectError(await cancel(NIL_UUID), 404, 'REGISTRATION_NOT_FOUND');
    });

    it('returns 400 for a malformed registration id', async () => {
      expectError(await cancel('nope'), 400, 'BAD_REQUEST');
    });

    it('cancelling a waitlisted registration does not change the seat count', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 1);
      await reg(w.id, `a-${uid()}`);
      const wl = await reg(w.id, `b-${uid()}`, true);
      const res = await cancel(wl.id);
      expect(res.body.status).toBe('CANCELLED');
      expect(await workshop(w.id)).toMatchObject({ activeCount: 1, seatsLeft: 0 });
      expect((await regs(w.id)).map((r) => r.status)).toEqual(['ACTIVE', 'CANCELLED']);
    });

    it('allows cancelling a registration on a completed workshop (seat released, no promotion)', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 2);
      const a = await reg(w.id, `a-${uid()}`);
      await call('patch', `/workshops/${w.id}`, tokens.manager, { status: 'COMPLETED' });
      expect((await cancel(a.id)).status).toBe(200);
      expect((await workshop(w.id)).activeCount).toBe(0);
    });

    describe('waitlist promotion', () => {
      it('promotes the oldest waitlisted person into the freed seat', async () => {
        const w = await scratchWorkshop(app, tokens.manager, 2);
        const a = await reg(w.id, `a-${uid()}`);
        await reg(w.id, `b-${uid()}`);
        const w1 = await reg(w.id, `w1-${uid()}`, true);
        const w2 = await reg(w.id, `w2-${uid()}`, true);

        expect((await cancel(a.id, { reason: 'No show' })).status).toBe(200);

        const list = await regs(w.id);
        const byId = Object.fromEntries(list.map((r) => [r.id, r]));
        expect(byId[w1.id].status).toBe('ACTIVE');
        expect(byId[w1.id].promotedAt).toMatch(ISO_RE);
        expect(byId[w2.id].status).toBe('WAITLISTED');
        expect(byId[w2.id].promotedAt).toBeNull();
        expect(await workshop(w.id)).toMatchObject({ activeCount: 2, seatsLeft: 0 });
        expect(await auditFor(w1.id)).toEqual(expect.arrayContaining(['REGISTRATION_WAITLISTED', 'REGISTRATION_PROMOTED']));
      });

      it('promotes strictly in FIFO order across successive cancellations', async () => {
        const w = await scratchWorkshop(app, tokens.manager, 1);
        const a = await reg(w.id, `a-${uid()}`);
        const queue = [];
        for (let i = 0; i < 3; i++) queue.push(await reg(w.id, `q${i}-${uid()}`, true));

        let current = a;
        for (const next of queue) {
          await cancel(current.id);
          const list = await regs(w.id);
          expect(list.find((r) => r.id === next.id)!.status).toBe('ACTIVE');
          expect((await workshop(w.id)).activeCount).toBe(1);
          current = next;
        }
        await cancel(current.id);
        expect((await workshop(w.id)).activeCount).toBe(0);
      });

      it('skips people who cancelled while waitlisted', async () => {
        const w = await scratchWorkshop(app, tokens.manager, 1);
        const a = await reg(w.id, `a-${uid()}`);
        const w1 = await reg(w.id, `w1-${uid()}`, true);
        const w2 = await reg(w.id, `w2-${uid()}`, true);
        await cancel(w1.id);
        await cancel(a.id);
        const list = await regs(w.id);
        expect(list.find((r) => r.id === w2.id)!.status).toBe('ACTIVE');
        expect(list.find((r) => r.id === w1.id)!.status).toBe('CANCELLED');
      });

      it('lets a promoted person cancel and passes the seat on again', async () => {
        const w = await scratchWorkshop(app, tokens.manager, 1);
        const a = await reg(w.id, `a-${uid()}`);
        const b = await reg(w.id, `b-${uid()}`, true);
        const c = await reg(w.id, `c-${uid()}`, true);
        await cancel(a.id);
        await cancel(b.id);
        const list = await regs(w.id);
        expect(list.find((r) => r.id === c.id)!.status).toBe('ACTIVE');
        expect((await workshop(w.id)).activeCount).toBe(1);
      });

      it('does not promote when the workshop is cancelled; the seat is simply released', async () => {
        const w = await scratchWorkshop(app, tokens.manager, 1);
        const a = await reg(w.id, `a-${uid()}`);
        const wl = await reg(w.id, `w-${uid()}`, true);
        await call('patch', `/workshops/${w.id}`, tokens.manager, { status: 'CANCELLED' });
        await cancel(a.id);
        const list = await regs(w.id);
        expect(list.find((r) => r.id === wl.id)!.status).toBe('WAITLISTED');
        expect((await workshop(w.id)).activeCount).toBe(0);
      });

      it('lets a new registrant take a seat freed by a cancel with an empty waitlist', async () => {
        const w = await scratchWorkshop(app, tokens.manager, 1);
        const a = await reg(w.id, `a-${uid()}`);
        await cancel(a.id);
        expect((await reg(w.id, `b-${uid()}`)).status).toBe('ACTIVE');
      });

      it('promotes waitlisted people when capacity is raised (and only as many as fit)', async () => {
        const w = await scratchWorkshop(app, tokens.manager, 1);
        await reg(w.id, `a-${uid()}`);
        const waiters = [];
        for (let i = 0; i < 4; i++) waiters.push(await reg(w.id, `w${i}-${uid()}`, true));

        const res = await call('patch', `/workshops/${w.id}`, tokens.manager, { capacity: 3 });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ capacity: 3, activeCount: 3, seatsLeft: 0 });

        const list = await regs(w.id);
        const statusOf = (id: string) => list.find((r) => r.id === id)!.status;
        expect(statusOf(waiters[0].id)).toBe('ACTIVE');
        expect(statusOf(waiters[1].id)).toBe('ACTIVE');
        expect(statusOf(waiters[2].id)).toBe('WAITLISTED');
        expect(statusOf(waiters[3].id)).toBe('WAITLISTED');
        expect(await auditFor(waiters[0].id)).toContain('REGISTRATION_PROMOTED');
      });

      it('raising capacity with an empty waitlist only adds free seats', async () => {
        const w = await scratchWorkshop(app, tokens.manager, 1);
        await reg(w.id, `a-${uid()}`);
        const res = await call('patch', `/workshops/${w.id}`, tokens.manager, { capacity: 4 });
        expect(res.body).toMatchObject({ activeCount: 1, seatsLeft: 3 });
      });
    });

    it('records the canceller when staff cancel a manager-made registration', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 2);
      const r = await reg(w.id, `a-${uid()}`, false, tokens.manager);
      const res = await cancel(r.id, {}, tokens.staff);
      expect(res.body.cancelledById).toBe(USERS.staff.id);
    });
  });
});
