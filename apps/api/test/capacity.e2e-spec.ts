import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createApp, createWorkshop, login, register } from './helpers.js';

describe('capacity rule', () => {
  let app: NestExpressApplication;
  let manager: string;
  let staff: string;

  beforeAll(async () => {
    app = await createApp();
    manager = await login(app, 'manager');
    staff = await login(app, 'staff');
  });
  afterAll(() => app.close());

  const get = (token: string, path: string) =>
    request(app.getHttpServer())
      .get(`/api${path}`)
      .set('Authorization', `Bearer ${token}`);

  const cancel = (id: string, reason?: string) =>
    request(app.getHttpServer())
      .post(`/api/registrations/${id}/cancel`)
      .set('Authorization', `Bearer ${staff}`)
      .send({ reason });

  it('never exceeds capacity with 30 parallel registrations', async () => {
    const w = await createWorkshop(app, manager, 5);
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => register(app, staff, w.id, i)),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 409)).toHaveLength(25);
    expect(
      results
        .filter((r) => r.status === 409)
        .every((r) => r.body.code === 'WORKSHOP_FULL'),
    ).toBe(true);

    const detail = await get(staff, `/workshops/${w.id}`);
    expect(detail.body.activeCount).toBe(5);
    expect(detail.body.seatsLeft).toBe(0);
    const regs = await get(staff, `/workshops/${w.id}/registrations`);
    expect(regs.body.filter((r: any) => r.status === 'ACTIVE')).toHaveLength(5);
    expect(regs.body).toHaveLength(5);
  });

  it('rejects the same attendee twice in parallel', async () => {
    const w = await createWorkshop(app, manager, 5);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => register(app, staff, w.id, 'same')),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      results.filter((r) => r.body.code === 'ALREADY_REGISTERED'),
    ).toHaveLength(4);
    const detail = await get(staff, `/workshops/${w.id}`);
    expect(detail.body.activeCount).toBe(1);
  });

  it('allows only one of 10 parallel cancels', async () => {
    const w = await createWorkshop(app, manager, 5);
    const reg = await register(app, staff, w.id, 1);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => cancel(reg.body.id, 'changed mind')),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);

    const detail = await get(staff, `/workshops/${w.id}`);
    expect(detail.body.activeCount).toBe(0);
    const regs = await get(staff, `/workshops/${w.id}/registrations`);
    expect(regs.body[0].status).toBe('CANCELLED');
    expect(regs.body[0].cancelledBy.name).toBeTruthy();
  });

  it('promotes the oldest waitlisted attendee on cancel and keeps the count at capacity', async () => {
    const w = await createWorkshop(app, manager, 2);
    const a = await register(app, staff, w.id, 'a');
    await register(app, staff, w.id, 'b');
    const full = await register(app, staff, w.id, 'c');
    expect(full.status).toBe(409);
    const c = await register(app, staff, w.id, 'c', true);
    const d = await register(app, staff, w.id, 'd', true);
    expect(c.status).toBe(201);
    expect(c.body.status).toBe('WAITLISTED');
    expect(d.body.status).toBe('WAITLISTED');

    await cancel(a.body.id).expect(200);

    const detail = await get(staff, `/workshops/${w.id}`);
    expect(detail.body.activeCount).toBe(2);
    const regs = (await get(staff, `/workshops/${w.id}/registrations`)).body;
    const byId = Object.fromEntries(regs.map((r: any) => [r.id, r]));
    expect(byId[c.body.id].status).toBe('ACTIVE');
    expect(byId[c.body.id].promotedAt).toBeTruthy();
    expect(byId[d.body.id].status).toBe('WAITLISTED');
  });

  it('guards capacity edits and promotes the waitlist when capacity grows', async () => {
    const w = await createWorkshop(app, manager, 2);
    await register(app, staff, w.id, 1);
    await register(app, staff, w.id, 2);
    const waiting = await register(app, staff, w.id, 3, true);

    const patch = (capacity: number) =>
      request(app.getHttpServer())
        .patch(`/api/workshops/${w.id}`)
        .set('Authorization', `Bearer ${manager}`)
        .send({ capacity });

    const shrink = await patch(1);
    expect(shrink.status).toBe(409);
    expect(shrink.body.code).toBe('CAPACITY_BELOW_REGISTERED');

    const grow = await patch(3);
    expect(grow.status).toBe(200);
    expect(grow.body.activeCount).toBe(3);
    const regs = (await get(staff, `/workshops/${w.id}/registrations`)).body;
    expect(regs.find((r: any) => r.id === waiting.body.id).status).toBe(
      'ACTIVE',
    );
  });
});
