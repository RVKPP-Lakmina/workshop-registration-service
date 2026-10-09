import { Injectable } from '@nestjs/common';
import { writeAudit } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { activate, lockNextWaitlisted } from './waitlist.js';

export interface RegisterInput {
  attendeeName: string;
  attendeeEmail: string;
  joinWaitlistIfFull?: boolean;
}

const alreadyRegistered = () =>
  new AppError(
    409,
    'ALREADY_REGISTERED',
    'This attendee is already registered or waitlisted for this workshop',
  );

@Injectable()
export class RegistrationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForWorkshop(workshopId: string) {
    const workshop = await this.prisma.workshop.findUnique({
      where: { id: workshopId },
      select: { id: true },
    });
    if (!workshop) throw workshopNotFound();
    return this.prisma.registration.findMany({
      where: { workshopId },
      orderBy: [{ registeredAt: 'asc' }, { id: 'asc' }],
      include: {
        registeredBy: { select: { id: true, name: true } },
        cancelledBy: { select: { id: true, name: true } },
      },
    });
  }

  async register(actorId: string, workshopId: string, input: RegisterInput) {
    const attendeeName = input.attendeeName.trim();
    const attendeeEmail = input.attendeeEmail.trim().toLowerCase();

    try {
      return await this.prisma.$transaction(async (tx) => {
        // One atomic statement: Postgres locks the workshop row, so a concurrent
        // request waits, then re-evaluates activeCount < capacity on fresh data.
        const { count } = await tx.workshop.updateMany({
          where: {
            id: workshopId,
            status: 'SCHEDULED',
            activeCount: { lt: tx.workshop.fields.capacity },
          },
          data: { activeCount: { increment: 1 } },
        });

        let status: 'ACTIVE' | 'WAITLISTED' = 'ACTIVE';
        if (count === 0) {
          const workshop = await tx.workshop.findUnique({
            where: { id: workshopId },
            select: { status: true },
          });
          if (!workshop) throw workshopNotFound();
          if (workshop.status !== 'SCHEDULED') {
            throw new AppError(
              409,
              'WORKSHOP_NOT_OPEN',
              'This workshop is not open for registration',
            );
          }
          if (!input.joinWaitlistIfFull) {
            throw new AppError(409, 'WORKSHOP_FULL', 'This workshop is full');
          }
          status = 'WAITLISTED';
        }

        const registration = await tx.registration.create({
          data: {
            workshopId,
            attendeeName,
            attendeeEmail,
            status,
            registeredById: actorId,
          },
        });
        await writeAudit(tx, {
          actorId,
          action:
            status === 'ACTIVE' ? 'REGISTRATION_CREATED' : 'REGISTRATION_WAITLISTED',
          entityType: 'REGISTRATION',
          entityId: registration.id,
          after: registration,
        });
        return registration;
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw alreadyRegistered();
      throw e;
    }
  }

  async cancel(actorId: string, registrationId: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.registration.findUnique({
        where: { id: registrationId },
        select: { workshopId: true },
      });
      if (!found) {
        throw new AppError(404, 'REGISTRATION_NOT_FOUND', 'Registration not found');
      }

      // Serialise with registrations/cancels on the same workshop so a seat
      // freed here can never be missed by a concurrent waitlist insert.
      await tx.$queryRaw`SELECT id FROM workshops WHERE id = ${found.workshopId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${registrationId}::uuid FOR UPDATE`;

      const before = await tx.registration.findUniqueOrThrow({
        where: { id: registrationId },
      });
      const { count } = await tx.registration.updateMany({
        where: { id: registrationId, status: { in: ['ACTIVE', 'WAITLISTED'] } },
        data: {
          status: 'CANCELLED',
          cancelledById: actorId,
          cancelledAt: new Date(),
          cancelReason: reason?.trim() || null,
        },
      });
      if (count === 0) {
        throw new AppError(
          409,
          'ALREADY_CANCELLED',
          'This registration has already been cancelled',
        );
      }

      const cancelled = await tx.registration.findUniqueOrThrow({
        where: { id: registrationId },
      });
      await writeAudit(tx, {
        actorId,
        action: 'REGISTRATION_CANCELLED',
        entityType: 'REGISTRATION',
        entityId: registrationId,
        before,
        after: cancelled,
      });

      if (before.status === 'ACTIVE') {
        const workshop = await tx.workshop.findUniqueOrThrow({
          where: { id: found.workshopId },
          select: { status: true },
        });
        const nextId =
          workshop.status === 'SCHEDULED'
            ? await lockNextWaitlisted(tx, found.workshopId)
            : null;
        if (nextId) {
          // The seat passes straight to the next person; activeCount is unchanged.
          await activate(tx, nextId, actorId);
        } else {
          await tx.workshop.updateMany({
            where: { id: found.workshopId, activeCount: { gt: 0 } },
            data: { activeCount: { decrement: 1 } },
          });
        }
      }
      return cancelled;
    });
  }
}

export const workshopNotFound = () =>
  new AppError(404, 'WORKSHOP_NOT_FOUND', 'Workshop not found');
