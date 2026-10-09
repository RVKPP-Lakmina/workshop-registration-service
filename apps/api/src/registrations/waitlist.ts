import { writeAudit } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';

// Oldest waitlisted registration, skipping rows another transaction has locked.
export async function lockNextWaitlisted(
  tx: Prisma.TransactionClient,
  workshopId: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM registrations
    WHERE workshop_id = ${workshopId}::uuid AND status = 'WAITLISTED'
    ORDER BY registered_at, id
    LIMIT 1
    FOR UPDATE SKIP LOCKED`;
  return rows[0]?.id ?? null;
}

export async function activate(
  tx: Prisma.TransactionClient,
  registrationId: string,
  actorId: string,
) {
  const promoted = await tx.registration.update({
    where: { id: registrationId },
    data: { status: 'ACTIVE', promotedAt: new Date() },
  });
  await writeAudit(tx, {
    actorId,
    action: 'REGISTRATION_PROMOTED',
    entityType: 'REGISTRATION',
    entityId: promoted.id,
    after: promoted,
  });
  return promoted;
}
