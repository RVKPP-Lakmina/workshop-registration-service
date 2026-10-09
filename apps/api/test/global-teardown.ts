import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnvFile } from '../src/config/env-file.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadEnvFile();

// Remove data created by the e2e suite so the dev database keeps only seed data.
async function clean() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    await prisma.$transaction([
      prisma.$executeRaw`DELETE FROM audit_logs WHERE actor_id IN (SELECT id FROM users WHERE email ~ '^(u|tmp)-.*@workshop.local$')
        OR entity_id IN (SELECT id::text FROM workshops WHERE code ~ '^(T|R)-')
        OR entity_id IN (SELECT r.id::text FROM registrations r JOIN workshops w ON w.id = r.workshop_id WHERE w.code ~ '^(T|R)-')
        OR entity_id IN (SELECT id::text FROM users WHERE email ~ '^(u|tmp)-.*@workshop.local$')`,
      prisma.$executeRaw`DELETE FROM registrations WHERE workshop_id IN (SELECT id FROM workshops WHERE code ~ '^(T|R)-')`,
      prisma.$executeRaw`DELETE FROM workshops WHERE code ~ '^(T|R)-'`,
      prisma.$executeRaw`DELETE FROM users WHERE email ~ '^(u|tmp)-.*@workshop.local$'`,
    ]);
  } finally {
    await prisma.$disconnect();
  }
}

export default async function setup() {
  await clean();
  return clean;
}
