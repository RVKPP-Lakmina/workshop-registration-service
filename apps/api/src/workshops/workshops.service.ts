import { Injectable } from '@nestjs/common';
import { writeAudit } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { Prisma, WorkshopStatus } from '../generated/prisma/client.js';
import type { Workshop } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { workshopNotFound } from '../registrations/registrations.service.js';
import { activate, lockNextWaitlisted } from '../registrations/waitlist.js';

export interface WorkshopFilters {
  from?: Date;
  to?: Date;
  status?: WorkshopStatus;
  hasSeats?: boolean;
  q?: string;
  location?: string;
}

export interface WorkshopInput {
  code: string;
  title: string;
  description?: string;
  instructor: string;
  location: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
}

export type WorkshopUpdate = Partial<WorkshopInput> & { status?: WorkshopStatus };

const withSeats = (w: Workshop) => ({
  ...w,
  seatsLeft: Math.max(w.capacity - w.activeCount, 0),
});

@Injectable()
export class WorkshopsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(f: WorkshopFilters) {
    const and: Prisma.WorkshopWhereInput[] = [];
    if (f.from || f.to) and.push({ startsAt: { gte: f.from, lte: f.to } });
    if (f.status) and.push({ status: f.status });
    if (f.hasSeats) {
      and.push({
        status: 'SCHEDULED',
        activeCount: { lt: this.prisma.workshop.fields.capacity },
      });
    }
    if (f.location) {
      and.push({ location: { equals: f.location, mode: 'insensitive' } });
    }
    if (f.q) {
      // Escape LIKE wildcards so '%' and '_' in the search text match literally.
      const term = f.q.replace(/[\\%_]/g, (c) => '\\' + c);
      const contains = { contains: term, mode: 'insensitive' as const };
      and.push({
        OR: [
          { title: contains },
          { code: contains },
          { instructor: contains },
          { description: contains },
        ],
      });
    }
    const rows = await this.prisma.workshop.findMany({
      where: { AND: and },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(withSeats);
  }

  async get(id: string) {
    const w = await this.prisma.workshop.findUnique({ where: { id } });
    if (!w) throw workshopNotFound();
    return withSeats(w);
  }

  async create(actorId: string, input: WorkshopInput) {
    assertDates(input.startsAt, input.endsAt);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const w = await tx.workshop.create({
          data: {
            ...input,
            code: input.code.trim().toUpperCase(),
            createdById: actorId,
            updatedById: actorId,
          },
        });
        await writeAudit(tx, {
          actorId,
          action: 'WORKSHOP_CREATED',
          entityType: 'WORKSHOP',
          entityId: w.id,
          after: w,
        });
        return withSeats(w);
      });
    } catch (e) {
      throw mapCodeTaken(e);
    }
  }

  async update(actorId: string, id: string, input: WorkshopUpdate) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.workshop.findUnique({ where: { id } });
        if (!before) throw workshopNotFound();
        assertDates(input.startsAt ?? before.startsAt, input.endsAt ?? before.endsAt);

        const data: Prisma.WorkshopUncheckedUpdateManyInput = {
          ...input,
          code: input.code?.trim().toUpperCase(),
          updatedById: actorId,
        };
        // Guarded write: refuses to shrink capacity below seats already taken,
        // even if a registration lands between the read above and this update.
        const { count } = await tx.workshop.updateMany({
          where: {
            id,
            ...(input.capacity !== undefined && {
              activeCount: { lte: input.capacity },
            }),
          },
          data,
        });
        if (count === 0) {
          throw new AppError(
            409,
            'CAPACITY_BELOW_REGISTERED',
            `Capacity cannot be lower than the ${before.activeCount} seats already taken`,
          );
        }

        let after = await tx.workshop.findUniqueOrThrow({ where: { id } });
        if (after.status === 'SCHEDULED' && after.capacity > before.capacity) {
          after = await this.fillFreedSeats(tx, actorId, after);
        }
        await writeAudit(tx, {
          actorId,
          action:
            input.status && input.status !== before.status
              ? `WORKSHOP_${input.status}`
              : 'WORKSHOP_UPDATED',
          entityType: 'WORKSHOP',
          entityId: id,
          before,
          after,
        });
        return withSeats(after);
      });
    } catch (e) {
      throw mapCodeTaken(e);
    }
  }

  private async fillFreedSeats(
    tx: Prisma.TransactionClient,
    actorId: string,
    workshop: Workshop,
  ) {
    let promoted = 0;
    while (workshop.activeCount + promoted < workshop.capacity) {
      const nextId = await lockNextWaitlisted(tx, workshop.id);
      if (!nextId) break;
      await activate(tx, nextId, actorId);
      promoted++;
    }
    if (promoted === 0) return workshop;
    return tx.workshop.update({
      where: { id: workshop.id },
      data: { activeCount: { increment: promoted } },
    });
  }
}

function assertDates(startsAt: Date, endsAt: Date) {
  if (endsAt <= startsAt) {
    throw new AppError(400, 'INVALID_DATES', 'End time must be after start time');
  }
}

function mapCodeTaken(e: unknown) {
  if ((e as { code?: string }).code === 'P2002') {
    return new AppError(409, 'CODE_TAKEN', 'A workshop with this code already exists');
  }
  return e;
}
