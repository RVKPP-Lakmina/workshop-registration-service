import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { loadEnvFile } from '../src/config/env-file.js';
import { PrismaClient, Role } from '../src/generated/prisma/client.js';

loadEnvFile();

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const users = [
  { email: 'admin@workshop.local', name: 'Alex Admin', role: Role.ADMIN, password: 'Admin123!' },
  { email: 'manager@workshop.local', name: 'Morgan Manager', role: Role.MANAGER, password: 'Manager123!' },
  { email: 'staff@workshop.local', name: 'Sam Staff', role: Role.STAFF, password: 'Staff123!' },
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Start of today (UTC) plus a day offset and an hour of the day.
function at(dayOffset: number, hour: number, durationHours = 2) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const startsAt = new Date(d.getTime() + dayOffset * DAY + hour * HOUR);
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationHours * HOUR) };
}

const attendees = [
  ['Priya Fernando', 'priya.f@example.com'],
  ['Nimal Perera', 'nimal.p@example.com'],
  ['Kasun Silva', 'kasun.s@example.com'],
  ['Dilini Jayawardena', 'dilini.j@example.com'],
  ['Ruwan Gunasekara', 'ruwan.g@example.com'],
  ['Amaya Wickramasinghe', 'amaya.w@example.com'],
];

interface SeedWorkshop {
  code: string;
  title: string;
  description: string;
  instructor: string;
  location: string;
  capacity: number;
  when: { startsAt: Date; endsAt: Date };
  status?: 'SCHEDULED' | 'CANCELLED' | 'COMPLETED';
  active: number;
  waitlisted?: number;
}

const workshops: SeedWorkshop[] = [
  { code: 'POT-101', title: 'Intro to Pottery', description: 'Wheel basics and glazing.', instructor: 'Hana Ito', location: 'Main Campus', capacity: 12, when: at(1, 10, 3), active: 4 },
  { code: 'COD-201', title: 'Python for Beginners', description: 'Write your first scripts.', instructor: 'Dev Patel', location: 'City Centre', capacity: 20, when: at(2, 9, 3), active: 6 },
  { code: 'FIT-110', title: 'Morning Yoga Flow', description: 'Gentle stretching and breathing.', instructor: 'Maya Rao', location: 'Lakeside', capacity: 15, when: at(3, 7, 1), active: 2 },
  { code: 'COD-310', title: 'Web Design Workshop', description: 'HTML, CSS and layout.', instructor: 'Dev Patel', location: 'City Centre', capacity: 3, when: at(4, 14, 2), active: 3, waitlisted: 1 },
  { code: 'ART-120', title: 'Watercolour Painting', description: 'Landscapes in watercolour.', instructor: 'Lena Fox', location: 'Main Campus', capacity: 10, when: at(8, 13, 2), active: 1 },
  { code: 'FIT-220', title: 'Strength and Conditioning', description: 'Beginner-friendly circuit training.', instructor: 'Omar Haddad', location: 'Lakeside', capacity: 18, when: at(9, 18, 1), active: 0 },
  { code: 'COD-150', title: 'Spreadsheet Skills', description: 'Formulas and pivot tables.', instructor: 'Ines Ortega', location: 'City Centre', capacity: 14, when: at(10, 10, 2), status: 'CANCELLED', active: 0 },
  { code: 'POT-090', title: 'Hand-Building Ceramics', description: 'Coil and slab techniques.', instructor: 'Hana Ito', location: 'Main Campus', capacity: 8, when: at(-5, 10, 3), status: 'COMPLETED', active: 5 },
];

async function main() {
  const passwordHashes = await Promise.all(users.map((u) => bcrypt.hash(u.password, 10)));
  const created = await Promise.all(
    users.map(({ password: _, ...u }, i) =>
      prisma.user.upsert({
        where: { email: u.email },
        update: {},
        create: { ...u, passwordHash: passwordHashes[i] },
      }),
    ),
  );
  const manager = created.find((u) => u.role === Role.MANAGER)!;
  const staff = created.find((u) => u.role === Role.STAFF)!;

  for (const w of workshops) {
    if (await prisma.workshop.findUnique({ where: { code: w.code } })) continue;
    const workshop = await prisma.workshop.create({
      data: {
        code: w.code,
        title: w.title,
        description: w.description,
        instructor: w.instructor,
        location: w.location,
        capacity: w.capacity,
        activeCount: w.active,
        status: w.status ?? 'SCHEDULED',
        startsAt: w.when.startsAt,
        endsAt: w.when.endsAt,
        createdById: manager.id,
        updatedById: manager.id,
      },
    });
    const total = w.active + (w.waitlisted ?? 0);
    for (let i = 0; i < total; i++) {
      const [attendeeName, attendeeEmail] = attendees[i % attendees.length];
      await prisma.registration.create({
        data: {
          workshopId: workshop.id,
          attendeeName,
          attendeeEmail: `${w.code.toLowerCase()}.${attendeeEmail}`,
          status: i < w.active ? 'ACTIVE' : 'WAITLISTED',
          registeredById: staff.id,
        },
      });
    }
    await prisma.auditLog.create({
      data: {
        actorId: manager.id,
        action: 'WORKSHOP_CREATED',
        entityType: 'WORKSHOP',
        entityId: workshop.id,
        after: { code: workshop.code, title: workshop.title },
      },
    });
  }
  console.log('Seeded 3 users and', workshops.length, 'workshops');
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
