import type { AuditEntry, Registration, User, Workshop } from '../types'

export const admin: User = { id: 'u-admin', email: 'admin@workshop.test', name: 'Ada Admin', role: 'ADMIN', isActive: true }
export const manager: User = { id: 'u-mgr', email: 'mgr@workshop.test', name: 'Mia Manager', role: 'MANAGER', isActive: true }
export const staff: User = { id: 'u-staff', email: 'staff@workshop.test', name: 'Sam Staff', role: 'STAFF', isActive: true }

export function makeWorkshop(over: Partial<Workshop> = {}): Workshop {
  return {
    id: 'w1',
    code: 'POT-101',
    title: 'Pottery Basics',
    description: 'Learn to throw a pot.',
    instructor: 'Priya',
    location: 'Main Campus',
    startsAt: '2030-05-01T10:00:00.000Z',
    endsAt: '2030-05-01T12:00:00.000Z',
    capacity: 10,
    activeCount: 4,
    seatsLeft: 6,
    status: 'SCHEDULED',
    ...over,
  }
}

export function makeReg(over: Partial<Registration> = {}): Registration {
  return {
    id: 'r1',
    workshopId: 'w1',
    attendeeName: 'Alice Attendee',
    attendeeEmail: 'alice@example.com',
    status: 'ACTIVE',
    registeredAt: '2030-04-01T09:00:00.000Z',
    registeredBy: { id: staff.id, name: staff.name },
    ...over,
  }
}

export function makeAudit(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 1,
    actor: { id: manager.id, name: manager.name },
    action: 'workshop.created',
    entityType: 'Workshop',
    entityId: 'w1',
    after: { title: 'Pottery Basics' },
    createdAt: '2030-04-01T09:00:00.000Z',
    ...over,
  }
}
