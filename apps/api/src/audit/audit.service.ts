import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntry {
  actorId: string;
  action: string;
  entityType: 'USER' | 'WORKSHOP' | 'REGISTRATION';
  entityId: string;
  before?: unknown;
  after?: unknown;
}

const toJson = (v: unknown) =>
  v === undefined || v === null
    ? Prisma.DbNull
    : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

export async function writeAudit(tx: Prisma.TransactionClient, e: AuditEntry) {
  await tx.auditLog.create({
    data: {
      actorId: e.actorId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      before: toJson(e.before),
      after: toJson(e.after),
    },
  });
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(role: Role, page: number, pageSize: number) {
    const where: Prisma.AuditLogWhereInput =
      role === Role.ADMIN
        ? { entityType: 'USER' }
        : { entityType: { in: ['WORKSHOP', 'REGISTRATION'] } };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    return {
      items: rows.map((r) => ({ ...r, id: r.id.toString() })),
      total,
      page,
      pageSize,
    };
  }
}
