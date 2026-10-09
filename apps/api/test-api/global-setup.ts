import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { Redis } from 'ioredis';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import {
  TEST_DATABASE_URL,
  TEST_PASSWORD,
  TEST_REDIS_URL,
  assertTestTargets,
  databaseName,
} from './config.ts';
import { ALL_REGISTRATIONS, ALL_WORKSHOPS, DAY, USERS, WORKSHOPS, when } from './fixtures.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    anchor: number;
  }
}

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const withoutSchema = (url: string) => {
  const u = new URL(url);
  u.search = '';
  return u;
};

async function ensureDatabase() {
  const name = databaseName(TEST_DATABASE_URL);
  const admin = withoutSchema(TEST_DATABASE_URL);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }
}

function migrate() {
  const prismaBin = path.join(apiDir, 'node_modules', 'prisma', 'build', 'index.js');
  const res = spawnSync(process.execPath, [prismaBin, 'migrate', 'deploy'], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`prisma migrate deploy failed:\n${res.stdout}\n${res.stderr}`);
  }
}

async function resetAndSeed(anchor: number) {
  const client = new pg.Client({ connectionString: withoutSchema(TEST_DATABASE_URL).toString() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'TRUNCATE audit_logs, registrations, workshops, users RESTART IDENTITY CASCADE',
    );

    const hash = await bcrypt.hash(TEST_PASSWORD, 4);
    for (const u of Object.values(USERS)) {
      await client.query(
        `INSERT INTO users (id, email, name, password_hash, role, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $5::"Role", $6, now())`,
        [u.id, u.email, u.name, hash, u.role, u.isActive],
      );
    }

    for (const w of ALL_WORKSHOPS) {
      const { startsAt, endsAt } = when(anchor, w);
      await client.query(
        `INSERT INTO workshops (id, code, title, description, instructor, location, starts_at, ends_at,
           capacity, active_count, status, created_by_id, updated_by_id, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::"WorkshopStatus",$12,$12, now())`,
        [
          w.id, w.code, w.title, w.description, w.instructor, w.location, startsAt.toISOString(), endsAt.toISOString(),
          w.capacity, w.activeCount, w.status, USERS.manager.id,
        ],
      );
    }

    const base = anchor - DAY;
    for (const r of ALL_REGISTRATIONS) {
      const registeredAt = new Date(base + r.minute * 60_000);
      const iso = (d: Date) => d.toISOString();
      await client.query(
        `INSERT INTO registrations (id, workshop_id, attendee_name, attendee_email, status, registered_by_id,
           registered_at, cancelled_by_id, cancelled_at, cancel_reason)
         VALUES ($1,$2,$3,$4,$5::"RegStatus",$6,$7,$8,$9,$10)`,
        [
          r.id, WORKSHOPS[r.workshop].id, r.name, r.email, r.status, USERS[r.registeredBy].id,
          iso(registeredAt),
          r.cancelledBy ? USERS[r.cancelledBy].id : null,
          r.cancelledBy ? iso(new Date(registeredAt.getTime() + 60_000)) : null,
          r.cancelReason ?? null,
        ],
      );
    }

    const audit = (actor: string, action: string, type: string, entityId: string, after: object) =>
      client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after, created_at)
         VALUES ($1,$2,$3,$4,$5::jsonb, now())`,
        [actor, action, type, entityId, JSON.stringify(after)],
      );
    await audit(USERS.admin.id, 'USER_CREATED', 'USER', USERS.manager.id, { email: USERS.manager.email });
    await audit(USERS.admin.id, 'USER_CREATED', 'USER', USERS.staff.id, { email: USERS.staff.email });
    for (const w of ALL_WORKSHOPS) {
      await audit(USERS.manager.id, 'WORKSHOP_CREATED', 'WORKSHOP', w.id, { code: w.code });
    }
    await audit(USERS.staff.id, 'REGISTRATION_CREATED', 'REGISTRATION', ALL_REGISTRATIONS[0].id, {});
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}

async function flushRedis() {
  const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: 2 });
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}

export default async function setup(project: TestProject) {
  assertTestTargets();
  await ensureDatabase();
  migrate();
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const anchor = d.getTime();
  await resetAndSeed(anchor);
  await flushRedis();
  project.provide('anchor', anchor);
}
