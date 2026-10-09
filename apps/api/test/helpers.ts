import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/setup.js';

export const CREDENTIALS = {
  admin: { email: 'admin@workshop.local', password: 'Admin123!' },
  manager: { email: 'manager@workshop.local', password: 'Manager123!' },
  staff: { email: 'staff@workshop.local', password: 'Staff123!' },
};

export async function createApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.listen(0);
  return app;
}

export async function login(
  app: NestExpressApplication,
  who: keyof typeof CREDENTIALS | { email: string; password: string },
) {
  const creds = typeof who === 'string' ? CREDENTIALS[who] : who;
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send(creds)
    .expect(200);
  return res.body.token as string;
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export async function createWorkshop(
  app: NestExpressApplication,
  managerToken: string,
  capacity: number,
) {
  const startsAt = new Date(Date.now() + 86_400_000);
  const res = await request(app.getHttpServer())
    .post('/api/workshops')
    .set('Authorization', `Bearer ${managerToken}`)
    .send({
      code: `T-${uid()}`,
      title: 'Test workshop',
      instructor: 'Tester',
      location: 'Main Campus',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      capacity,
    })
    .expect(201);
  return res.body as { id: string; capacity: number; activeCount: number };
}

export const register = (
  app: NestExpressApplication,
  token: string,
  workshopId: string,
  n: number | string,
  joinWaitlistIfFull = false,
) =>
  request(app.getHttpServer())
    .post(`/api/workshops/${workshopId}/registrations`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      attendeeName: `Attendee ${n}`,
      attendeeEmail: `attendee${n}@example.com`,
      joinWaitlistIfFull,
    });
