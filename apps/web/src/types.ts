export type Role = 'ADMIN' | 'MANAGER' | 'STAFF'
export type WorkshopStatus = 'SCHEDULED' | 'CANCELLED' | 'COMPLETED'
export type RegStatus = 'ACTIVE' | 'WAITLISTED' | 'CANCELLED'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  isActive: boolean
  createdAt?: string
}

export interface LoginResponse {
  user: User
}

export interface Workshop {
  id: string
  code: string
  title: string
  description?: string | null
  instructor: string
  location: string
  startsAt: string
  endsAt: string
  capacity: number
  activeCount: number
  seatsLeft: number
  status: WorkshopStatus
}

export interface WorkshopInput {
  code: string
  title: string
  description?: string
  instructor: string
  location: string
  startsAt: string
  endsAt: string
  capacity: number
  status?: WorkshopStatus
}

export interface PersonRef {
  id: string
  name: string
}

export interface Registration {
  id: string
  workshopId: string
  attendeeName: string
  attendeeEmail: string
  status: RegStatus
  registeredAt: string
  registeredBy: PersonRef | null
  cancelledAt?: string | null
  cancelledBy?: PersonRef | null
  cancelReason?: string | null
  promotedAt?: string | null
}

export interface AuditEntry {
  id: string | number
  actor?: PersonRef | null
  actorId?: string
  action: string
  entityType: string
  entityId: string
  before?: unknown
  after?: unknown
  createdAt: string
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export const LOCATIONS = ['Main Campus', 'City Centre', 'Lakeside']
