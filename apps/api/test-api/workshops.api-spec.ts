import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_WORKSHOPS, DAY, FIXTURE_WORKSHOP_IDS, HOUR, USERS, WORKSHOPS, type WorkshopKey, when,
} from './fixtures.ts';
import {
  type App, NIL_UUID, anchor, client, createApp, expectError, loginAll, register, scratchWorkshop,
  uid, workshopWindow,
} from './helpers.ts';
import { expectWorkshopShape } from './shapes.ts';

type Tokens = Awaited<ReturnType<typeof loginAll>>;

describe('workshops', () => {
  let app: App;
  let call: ReturnType<typeof client>;
  let tokens: Tokens;

  beforeAll(async () => {
    app = await createApp();
    call = client(app);
    tokens = await loginAll(app);
  });
  afterAll(() => app.close());

  /** Fixture workshops in a list response, as keys, in response order. */
  const fixtureKeys = (body: { id: string }[]): WorkshopKey[] =>
    body
      .filter((w) => FIXTURE_WORKSHOP_IDS.has(w.id))
      .map((w) => ALL_WORKSHOPS.find((f) => f.id === w.id)!.key as WorkshopKey);
  const list = async (query = '', token = tokens.staff) => {
    const res = await call('get', `/workshops${query}`, token);
    expect(res.status).toBe(200);
    return res.body as { id: string }[];
  };
  const startOf = (k: WorkshopKey) => when(anchor(), WORKSHOPS[k]).startsAt;

  describe('GET /workshops', () => {
    it.each(['manager', 'staff'] as const)('lists workshops for %s with the full shape', async (role) => {
      const body = await list('', tokens[role]);
      expect(fixtureKeys(body).sort()).toEqual(Object.keys(WORKSHOPS).sort());
      for (const w of body) expectWorkshopShape(w as unknown as Record<string, unknown>);
    });

    it('returns fixture values and computed seatsLeft', async () => {
      const body = (await list()) as unknown as Record<string, unknown>[];
      for (const fx of ALL_WORKSHOPS) {
        const w = body.find((x) => x.id === fx.id)!;
        const win = when(anchor(), fx);
        expect(w).toMatchObject({
          code: fx.code,
          title: fx.title,
          description: fx.description,
          instructor: fx.instructor,
          location: fx.location,
          capacity: fx.capacity,
          activeCount: fx.activeCount,
          seatsLeft: fx.capacity - fx.activeCount,
          status: fx.status,
          startsAt: win.startsAt.toISOString(),
          endsAt: win.endsAt.toISOString(),
          createdById: USERS.manager.id,
          updatedById: USERS.manager.id,
        });
      }
    });

    it('orders by start time ascending', async () => {
      const body = (await list()) as unknown as { startsAt: string }[];
      const times = body.map((w) => Date.parse(w.startsAt));
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(fixtureKeys(body as unknown as { id: string }[])).toEqual([
        'completed', 'pastScheduled', 'open', 'full', 'last', 'empty', 'cancelled', 'far',
      ]);
    });

    describe('status filter', () => {
      it.each([
        ['SCHEDULED', ['pastScheduled', 'open', 'full', 'last', 'empty', 'far']],
        ['CANCELLED', ['cancelled']],
        ['COMPLETED', ['completed']],
      ])('status=%s', async (status, expected) => {
        expect(fixtureKeys(await list(`?status=${status}`))).toEqual(expected);
        const body = await list(`?status=${status}`);
        expect(body.every((w) => (w as unknown as { status: string }).status === status)).toBe(true);
      });

      it('rejects an unknown status with 400', async () => {
        expectError(await call('get', '/workshops?status=BOGUS', tokens.staff), 400, 'VALIDATION_ERROR');
        expectError(await call('get', '/workshops?status=scheduled', tokens.staff), 400, 'VALIDATION_ERROR');
      });
    });

    describe('from / to filters', () => {
      const a = () => new Date(anchor());
      it('from keeps workshops starting at or after the bound', async () => {
        const from = new Date(a().getTime() + 4 * DAY).toISOString();
        expect(fixtureKeys(await list(`?from=${from}`))).toEqual(['full', 'last', 'empty', 'cancelled', 'far']);
      });

      it('from is inclusive', async () => {
        expect(fixtureKeys(await list(`?from=${startOf('open').toISOString()}&to=${startOf('open').toISOString()}`)))
          .toEqual(['open']);
      });

      it('to keeps workshops starting at or before the bound', async () => {
        const to = a().toISOString();
        expect(fixtureKeys(await list(`?to=${to}`))).toEqual(['completed', 'pastScheduled']);
      });

      it('from and to combine as an inclusive window', async () => {
        const q = `?from=${startOf('open').toISOString()}&to=${startOf('last').toISOString()}`;
        expect(fixtureKeys(await list(q))).toEqual(['open', 'full', 'last']);
      });

      it('accepts a plain date (YYYY-MM-DD)', async () => {
        const day = new Date(a().getTime() + 30 * DAY).toISOString().slice(0, 10);
        expect(fixtureKeys(await list(`?from=${day}&to=${day}T23:59:59Z`))).toEqual(['far']);
      });

      it('returns nothing for an empty window', async () => {
        const from = new Date(a().getTime() + 200 * DAY).toISOString();
        expect(fixtureKeys(await list(`?from=${from}`))).toEqual([]);
        const to = new Date(a().getTime() + 100 * DAY).toISOString();
        const from2 = new Date(a().getTime() + 101 * DAY).toISOString();
        expect(await list(`?from=${from2}&to=${to}`)).toEqual([]);
      });

      it.each(['from', 'to'])('rejects an invalid %s date with 400', async (field) => {
        expectError(await call('get', `/workshops?${field}=not-a-date`, tokens.staff), 400, 'VALIDATION_ERROR');
      });
    });

    describe('hasSeats filter', () => {
      it('hasSeats=true returns only scheduled workshops with free seats', async () => {
        expect(fixtureKeys(await list('?hasSeats=true'))).toEqual(['pastScheduled', 'open', 'last', 'empty', 'far']);
      });

      it('hasSeats=true excludes full, cancelled and completed workshops', async () => {
        const keys = fixtureKeys(await list('?hasSeats=true'));
        expect(keys).not.toContain('full');
        expect(keys).not.toContain('cancelled');
        expect(keys).not.toContain('completed');
      });

      it('hasSeats=false (or any non-true value) applies no filter', async () => {
        expect(fixtureKeys(await list('?hasSeats=false')).length).toBe(ALL_WORKSHOPS.length);
        expect(fixtureKeys(await list('?hasSeats=abc')).length).toBe(ALL_WORKSHOPS.length);
      });

      it('combines with status (contradiction yields no fixtures)', async () => {
        expect(fixtureKeys(await list('?hasSeats=true&status=COMPLETED'))).toEqual([]);
        expect(fixtureKeys(await list('?hasSeats=true&status=SCHEDULED'))).toEqual(
          ['pastScheduled', 'open', 'last', 'empty', 'far'],
        );
      });

      it('reflects a seat being taken (a scratch workshop drops out when full)', async () => {
        const w = await scratchWorkshop(app, tokens.manager, 1);
        expect((await list('?hasSeats=true')).map((x) => x.id)).toContain(w.id);
        await register(app, tokens.staff, w.id, `hs-${uid()}`);
        expect((await list('?hasSeats=true')).map((x) => x.id)).not.toContain(w.id);
      });
    });

    describe('q search', () => {
      it.each([
        ['title, case-insensitive', 'pOtTeRy', ['open']],
        ['code', 'fx-open', ['open']],
        ['code prefix matches every fixture', 'FX-', Object.keys(WORKSHOPS).sort()],
        ['instructor', 'hana', ['open', 'completed']],
        ['description', 'glazing', ['open']],
        ['partial word', 'colour', ['empty']],
      ])('matches %s', async (_n, q, expected) => {
        const keys = fixtureKeys(await list(`?q=${encodeURIComponent(q)}`));
        expect([...keys].sort()).toEqual([...expected].sort());
      });

      it('returns an empty list when nothing matches', async () => {
        expect(await list('?q=zzzz-no-such-thing')).toEqual([]);
      });

      it('is safe against quotes and SQL metacharacters', async () => {
        expect(await list('?q=%27%3B--')).toEqual([]);
      });

      // LIKE wildcards in the search text must match literally (escaped in WorkshopsService.list).
      it('treats % in q literally', async () => {
        expect(await list('?q=%25')).toEqual([]);
      });

      it('rejects q over 100 chars with 400', async () => {
        expectError(await call('get', `/workshops?q=${'a'.repeat(101)}`, tokens.staff), 400, 'VALIDATION_ERROR');
      });
    });

    describe('location filter', () => {
      it.each([
        ['Main Campus', ['open', 'empty', 'completed']],
        ['main campus', ['open', 'empty', 'completed']],
        ['City Centre', ['pastScheduled', 'full', 'far']],
        ['Lakeside', ['last', 'cancelled']],
      ])('location=%s', async (loc, expected) => {
        const keys = fixtureKeys(await list(`?location=${encodeURIComponent(loc)}`));
        expect([...keys].sort()).toEqual([...expected].sort());
      });

      it('is an exact (case-insensitive) match, not a substring match', async () => {
        expect(await list('?location=Main')).toEqual([]);
      });

      it('returns nothing for an unknown location', async () => {
        expect(await list('?location=Mars')).toEqual([]);
      });

      it('rejects location over 100 chars with 400', async () => {
        expectError(await call('get', `/workshops?location=${'a'.repeat(101)}`, tokens.staff), 400, 'VALIDATION_ERROR');
      });
    });

    it('combines every filter together', async () => {
      const from = new Date(anchor() - 10 * DAY).toISOString();
      const to = new Date(anchor() + 40 * DAY).toISOString();
      const q = `?from=${from}&to=${to}&status=SCHEDULED&hasSeats=true&q=skills&location=city%20centre`;
      expect(fixtureKeys(await list(q))).toEqual(['far']);
    });

    it('ignores unknown query parameters', async () => {
      expect((await call('get', '/workshops?bogus=1', tokens.staff)).status).toBe(200);
    });
  });

  describe('GET /workshops/:id', () => {
    it.each(ALL_WORKSHOPS)('returns fixture $code', async (fx) => {
      const res = await call('get', `/workshops/${fx.id}`, tokens.staff);
      expect(res.status).toBe(200);
      expectWorkshopShape(res.body);
      expect(res.body).toMatchObject({
        id: fx.id,
        code: fx.code,
        capacity: fx.capacity,
        activeCount: fx.activeCount,
        seatsLeft: fx.capacity - fx.activeCount,
        status: fx.status,
        description: fx.description,
      });
    });

    it('manager can read too', async () => {
      expect((await call('get', `/workshops/${WORKSHOPS.open.id}`, tokens.manager)).status).toBe(200);
    });

    it('returns 404 WORKSHOP_NOT_FOUND for an unknown id', async () => {
      expectError(await call('get', `/workshops/${NIL_UUID}`, tokens.staff), 404, 'WORKSHOP_NOT_FOUND');
    });

    it('returns 400 for a malformed id', async () => {
      expectError(await call('get', '/workshops/123', tokens.staff), 400, 'BAD_REQUEST');
    });

    it('reports seatsLeft 0 for the full workshop', async () => {
      const res = await call('get', `/workshops/${WORKSHOPS.full.id}`, tokens.staff);
      expect(res.body).toMatchObject({ activeCount: 3, capacity: 3, seatsLeft: 0 });
    });
  });

  describe('POST /workshops', () => {
    const body = (over: Record<string, unknown> = {}) => ({
      code: `c-${uid()}`,
      title: 'Created workshop',
      description: 'Some description',
      instructor: 'Ivy Instructor',
      location: 'Scratch Room',
      ...workshopWindow(5),
      capacity: 12,
      ...over,
    });

    it('creates a workshop (201) with defaults, upper-cased code and audit entry', async () => {
      const payload = body({ code: `  c-${uid()} ` });
      const res = await call('post', '/workshops', tokens.manager, payload);
      expect(res.status).toBe(201);
      expectWorkshopShape(res.body);
      expect(res.body).toMatchObject({
        code: payload.code.trim().toUpperCase(),
        title: 'Created workshop',
        description: 'Some description',
        instructor: 'Ivy Instructor',
        location: 'Scratch Room',
        capacity: 12,
        activeCount: 0,
        seatsLeft: 12,
        status: 'SCHEDULED',
        createdById: USERS.manager.id,
        updatedById: USERS.manager.id,
        startsAt: payload.startsAt.toISOString(),
        endsAt: payload.endsAt.toISOString(),
      });

      const audit = await call('get', '/audit?pageSize=100', tokens.manager);
      expect(audit.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: 'WORKSHOP_CREATED', entityId: res.body.id, actor: expect.objectContaining({ id: USERS.manager.id }) }),
        ]),
      );
      const fetched = await call('get', `/workshops/${res.body.id}`, tokens.staff);
      expect(fetched.body.id).toBe(res.body.id);
    });

    it('allows the description to be omitted (null)', async () => {
      const { description: _d, ...rest } = body();
      const res = await call('post', '/workshops', tokens.manager, rest);
      expect(res.status).toBe(201);
      expect(res.body.description).toBeNull();
    });

    it('accepts boundary values (capacity 1 and 10000, code 30 chars)', async () => {
      expect((await call('post', '/workshops', tokens.manager, body({ capacity: 1 }))).status).toBe(201);
      expect((await call('post', '/workshops', tokens.manager, body({ capacity: 10000 }))).status).toBe(201);
      expect((await call('post', '/workshops', tokens.manager, body({ code: `L${uid()}`.padEnd(30, 'x') }))).status).toBe(201);
    });

    it('returns 409 CODE_TAKEN for a duplicate code, case-insensitively', async () => {
      expectError(await call('post', '/workshops', tokens.manager, body({ code: WORKSHOPS.open.code })), 409, 'CODE_TAKEN');
      expectError(await call('post', '/workshops', tokens.manager, body({ code: WORKSHOPS.open.code.toLowerCase() })), 409, 'CODE_TAKEN');
    });

    it.each([
      ['missing code', { code: undefined }],
      ['empty code', { code: '' }],
      ['code over 30 chars', { code: 'x'.repeat(31) }],
      ['missing title', { title: undefined }],
      ['title over 200 chars', { title: 'x'.repeat(201) }],
      ['description over 2000 chars', { description: 'x'.repeat(2001) }],
      ['missing instructor', { instructor: undefined }],
      ['missing location', { location: undefined }],
      ['missing startsAt', { startsAt: undefined }],
      ['invalid startsAt', { startsAt: 'tomorrow-ish' }],
      ['missing endsAt', { endsAt: undefined }],
      ['missing capacity', { capacity: undefined }],
      ['capacity 0', { capacity: 0 }],
      ['negative capacity', { capacity: -3 }],
      ['capacity over 10000', { capacity: 10001 }],
      ['fractional capacity', { capacity: 2.5 }],
      ['non-numeric capacity', { capacity: 'lots' }],
    ])('returns 400 VALIDATION_ERROR for %s', async (_n, over) => {
      expectError(await call('post', '/workshops', tokens.manager, body(over)), 400, 'VALIDATION_ERROR');
    });

    it('returns 400 INVALID_DATES when endsAt is before startsAt', async () => {
      const w = workshopWindow(5);
      expectError(
        await call('post', '/workshops', tokens.manager, body({ startsAt: w.endsAt, endsAt: w.startsAt })),
        400, 'INVALID_DATES',
      );
    });

    it('returns 400 INVALID_DATES when endsAt equals startsAt', async () => {
      const w = workshopWindow(5);
      expectError(
        await call('post', '/workshops', tokens.manager, body({ startsAt: w.startsAt, endsAt: w.startsAt })),
        400, 'INVALID_DATES',
      );
    });

    it('ignores client-supplied server fields (activeCount, status, createdById)', async () => {
      const res = await call('post', '/workshops', tokens.manager, body({
        activeCount: 7, status: 'COMPLETED', createdById: USERS.admin.id, id: NIL_UUID,
      }));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ activeCount: 0, status: 'SCHEDULED', createdById: USERS.manager.id });
      expect(res.body.id).not.toBe(NIL_UUID);
    });

    it('does not create anything when validation fails', async () => {
      const code = `nv-${uid()}`;
      await call('post', '/workshops', tokens.manager, body({ code, capacity: 0 }));
      expect(await list(`?q=${code}`)).toEqual([]);
    });
  });

  describe('PATCH /workshops/:id', () => {
    it('updates scalar fields and bumps updatedById', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 10);
      const res = await call('patch', `/workshops/${w.id}`, tokens.manager, {
        title: 'Retitled', description: 'New text', instructor: 'New Person', location: 'Elsewhere',
      });
      expect(res.status).toBe(200);
      expectWorkshopShape(res.body);
      expect(res.body).toMatchObject({
        id: w.id, title: 'Retitled', description: 'New text', instructor: 'New Person',
        location: 'Elsewhere', capacity: 10, updatedById: USERS.manager.id,
      });
      expect((await call('get', `/workshops/${w.id}`, tokens.staff)).body.title).toBe('Retitled');
    });

    it('updates dates', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 10);
      const win = workshopWindow(9);
      const res = await call('patch', `/workshops/${w.id}`, tokens.manager, win);
      expect(res.status).toBe(200);
      expect(res.body.startsAt).toBe(win.startsAt.toISOString());
      expect(res.body.endsAt).toBe(win.endsAt.toISOString());
    });

    it('changes the code (upper-cased) and frees the old one', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 5);
      const newCode = `n-${uid()}`;
      const res = await call('patch', `/workshops/${w.id}`, tokens.manager, { code: newCode });
      expect(res.body.code).toBe(newCode.toUpperCase());
      const reuse = await call('post', '/workshops', tokens.manager, {
        code: w.code, title: 't', instructor: 'i', location: 'Scratch Room', ...workshopWindow(), capacity: 1,
      });
      expect(reuse.status).toBe(201);
    });

    it('returns 409 CODE_TAKEN when renaming to an existing code', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 5);
      expectError(await call('patch', `/workshops/${w.id}`, tokens.manager, { code: WORKSHOPS.far.code }), 409, 'CODE_TAKEN');
      expectError(await call('patch', `/workshops/${w.id}`, tokens.manager, { code: WORKSHOPS.far.code.toLowerCase() }), 409, 'CODE_TAKEN');
    });

    it('keeping the same code is fine', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 5);
      expect((await call('patch', `/workshops/${w.id}`, tokens.manager, { code: w.code })).status).toBe(200);
    });

    it('raises capacity and recomputes seatsLeft', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 2);
      await register(app, tokens.staff, w.id, `a-${uid()}`);
      const res = await call('patch', `/workshops/${w.id}`, tokens.manager, { capacity: 6 });
      expect(res.body).toMatchObject({ capacity: 6, activeCount: 1, seatsLeft: 5 });
    });

    it('lowers capacity down to exactly the active count', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 5);
      await register(app, tokens.staff, w.id, `a-${uid()}`);
      await register(app, tokens.staff, w.id, `b-${uid()}`);
      const res = await call('patch', `/workshops/${w.id}`, tokens.manager, { capacity: 2 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ capacity: 2, activeCount: 2, seatsLeft: 0 });
    });

    it('returns 409 CAPACITY_BELOW_REGISTERED when shrinking below active registrations', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 5);
      for (const n of ['a', 'b', 'c']) await register(app, tokens.staff, w.id, `${n}-${uid()}`);
      expectError(await call('patch', `/workshops/${w.id}`, tokens.manager, { capacity: 2 }), 409, 'CAPACITY_BELOW_REGISTERED');
      expect((await call('get', `/workshops/${w.id}`, tokens.staff)).body.capacity).toBe(5);
    });

    it('does not count waitlisted people against the capacity floor', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 2);
      await register(app, tokens.staff, w.id, `a-${uid()}`);
      await register(app, tokens.staff, w.id, `b-${uid()}`);
      await register(app, tokens.staff, w.id, `c-${uid()}`, true);
      expect((await call('patch', `/workshops/${w.id}`, tokens.manager, { capacity: 2 })).status).toBe(200);
    });

    it('applies nothing when the capacity guard rejects a multi-field patch', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 3);
      await register(app, tokens.staff, w.id, `a-${uid()}`);
      await register(app, tokens.staff, w.id, `b-${uid()}`);
      expectError(
        await call('patch', `/workshops/${w.id}`, tokens.manager, { capacity: 1, title: 'Should not apply' }),
        409, 'CAPACITY_BELOW_REGISTERED',
      );
      expect((await call('get', `/workshops/${w.id}`, tokens.staff)).body.title).toBe('Scratch workshop');
    });

    it('changes status to CANCELLED and COMPLETED with matching audit actions', async () => {
      const a = await scratchWorkshop(app, tokens.manager, 3);
      const b = await scratchWorkshop(app, tokens.manager, 3);
      expect((await call('patch', `/workshops/${a.id}`, tokens.manager, { status: 'CANCELLED' })).body.status).toBe('CANCELLED');
      expect((await call('patch', `/workshops/${b.id}`, tokens.manager, { status: 'COMPLETED' })).body.status).toBe('COMPLETED');
      const items = (await call('get', '/audit?pageSize=100', tokens.manager)).body.items as { entityId: string; action: string }[];
      expect(items.find((i) => i.entityId === a.id && i.action === 'WORKSHOP_CANCELLED')).toBeTruthy();
      expect(items.find((i) => i.entityId === b.id && i.action === 'WORKSHOP_COMPLETED')).toBeTruthy();
    });

    it('can reopen a cancelled workshop (status back to SCHEDULED)', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 3);
      await call('patch', `/workshops/${w.id}`, tokens.manager, { status: 'CANCELLED' });
      const res = await call('patch', `/workshops/${w.id}`, tokens.manager, { status: 'SCHEDULED' });
      expect(res.body.status).toBe('SCHEDULED');
      expect((await register(app, tokens.staff, w.id, `a-${uid()}`)).status).toBe(201);
    });

    it('records WORKSHOP_UPDATED for a plain edit', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 3);
      await call('patch', `/workshops/${w.id}`, tokens.manager, { title: 'edited' });
      const items = (await call('get', '/audit?pageSize=100', tokens.manager)).body.items as { entityId: string; action: string; before: { title: string }; after: { title: string } }[];
      const entry = items.find((i) => i.entityId === w.id && i.action === 'WORKSHOP_UPDATED')!;
      expect(entry.before.title).toBe('Scratch workshop');
      expect(entry.after.title).toBe('edited');
    });

    it('accepts an empty patch', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 3);
      const res = await call('patch', `/workshops/${w.id}`, tokens.manager, {});
      expect(res.status).toBe(200);
      expect(res.body.capacity).toBe(3);
    });

    it('returns 400 INVALID_DATES when only endsAt moves before the stored start', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 3);
      const res = await call('patch', `/workshops/${w.id}`, tokens.manager, { endsAt: new Date(Date.now() - 10 * DAY) });
      expectError(res, 400, 'INVALID_DATES');
    });

    it('returns 400 INVALID_DATES when only startsAt moves after the stored end', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 3);
      const res = await call('patch', `/workshops/${w.id}`, tokens.manager, { startsAt: new Date(Date.now() + 90 * DAY) });
      expectError(res, 400, 'INVALID_DATES');
    });

    it('returns 404 WORKSHOP_NOT_FOUND for an unknown id', async () => {
      expectError(await call('patch', `/workshops/${NIL_UUID}`, tokens.manager, { title: 'x' }), 404, 'WORKSHOP_NOT_FOUND');
      expectError(await call('patch', `/workshops/${NIL_UUID}`, tokens.manager, { capacity: 3 }), 404, 'WORKSHOP_NOT_FOUND');
    });

    it('returns 400 for a malformed id', async () => {
      expect((await call('patch', '/workshops/xyz', tokens.manager, { title: 'x' })).status).toBe(400);
    });

    it.each([
      ['empty title', { title: '' }],
      ['title over 200', { title: 'x'.repeat(201) }],
      ['empty code', { code: '' }],
      ['code over 30', { code: 'x'.repeat(31) }],
      ['capacity 0', { capacity: 0 }],
      ['capacity over 10000', { capacity: 10001 }],
      ['fractional capacity', { capacity: 3.3 }],
      ['unknown status', { status: 'ARCHIVED' }],
      ['invalid date', { startsAt: 'soon' }],
      ['empty instructor', { instructor: '' }],
      ['empty location', { location: '' }],
      ['description over 2000', { description: 'x'.repeat(2001) }],
    ])('returns 400 VALIDATION_ERROR for %s', async (_n, payload) => {
      const w = await scratchWorkshop(app, tokens.manager, 3);
      expectError(await call('patch', `/workshops/${w.id}`, tokens.manager, payload), 400, 'VALIDATION_ERROR');
    });

    it('ignores non-patchable fields (activeCount, createdById)', async () => {
      const w = await scratchWorkshop(app, tokens.manager, 3);
      const res = await call('patch', `/workshops/${w.id}`, tokens.manager, { activeCount: 3, createdById: USERS.admin.id });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ activeCount: 0, createdById: USERS.manager.id });
    });
  });

  it('keeps fixture workshops unmodified by this spec', async () => {
    const res = await call('get', `/workshops/${WORKSHOPS.open.id}`, tokens.staff);
    expect(res.body).toMatchObject({ capacity: 10, activeCount: 2, status: 'SCHEDULED' });
    void HOUR;
  });
});
