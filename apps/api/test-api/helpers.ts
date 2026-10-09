import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/setup.js';
import { TEST_PASSWORD } from './config.ts';
import { USERS, WORKSHOPS, type RoleKey, type UserKey, when } from './fixtures.ts';

export { TEST_PASSWORD };
export const anchor = () => inject('anchor');
export const NIL_UUID = '00000000-0000-4000-8000-000000000000';
export const uid = () => randomUUID().slice(0, 8);

export async function createApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.listen(0);
  return app;
}

export type App = NestExpressApplication;
export type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

export function client(app: App) {
  return (method: Method, path: string, token?: string | null, body?: object) => {
    const req = request(app.getHttpServer())[method](`/api${path}`);
    if (token) void req.set('Authorization', `Bearer ${token}`);
    return body ? req.send(body) : req;
  };
}

export async function login(app: App, who: UserKey | { email: string; password: string }) {
  const creds =
    typeof who === 'string' ? { email: USERS[who].email, password: TEST_PASSWORD } : who;
  const res = await request(app.getHttpServer()).post('/api/auth/login').send(creds).expect(200);
  return sessionToken(res);
}

export async function loginAll(app: App): Promise<Record<RoleKey, string>> {
  return {
    admin: await login(app, 'admin'),
    manager: await login(app, 'manager'),
    staff: await login(app, 'staff'),
  };
}

export function expectError(
  res: { status: number; body: Record<string, unknown> },
  status: number,
  code: string,
) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual({ statusCode: status, code, message: expect.any(String) });
}

export const workshopWindow = (daysAhead = 2) => {
  const startsAt = new Date(Date.now() + daysAhead * 86_400_000);
  return { startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) };
};

export interface WorkshopBody {
  id: string;
  code: string;
  capacity: number;
  activeCount: number;
  seatsLeft: number;
  status: string;
}

/** Creates an isolated workshop through the API so a spec never shares mutable state. */
export async function scratchWorkshop(
  app: App,
  managerToken: string,
  capacity: number,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app.getHttpServer())
    .post('/api/workshops')
    .set('Authorization', `Bearer ${managerToken}`)
    .send({
      code: `S-${uid()}`,
      title: 'Scratch workshop',
      instructor: 'Scratch Instructor',
      location: 'Scratch Room',
      ...workshopWindow(),
      capacity,
      ...overrides,
    })
    .expect(201);
  return res.body as WorkshopBody;
}

export const registerBody = (n: number | string, joinWaitlistIfFull = false) => ({
  attendeeName: `Attendee ${n}`,
  attendeeEmail: `attendee${n}@example.com`,
  joinWaitlistIfFull,
});

export const register = (
  app: App,
  token: string,
  workshopId: string,
  n: number | string,
  joinWaitlistIfFull = false,
) => client(app)('post', `/workshops/${workshopId}/registrations`, token, registerBody(n, joinWaitlistIfFull));

export const fixtureWindow = (key: keyof typeof WORKSHOPS) => when(anchor(), WORKSHOPS[key]);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The login response carries the JWT only in the HttpOnly session cookie; tests send it back as a Bearer token. */
export function sessionToken(res: { headers: Record<string, unknown> }): string {
  const cookies = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
  const raw = cookies.find((c) => c.startsWith('wr_session='));
  if (!raw) throw new Error('login did not set the wr_session cookie');
  return decodeURIComponent(raw.split(';')[0].slice('wr_session='.length));
}
