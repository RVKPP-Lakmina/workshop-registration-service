// Deterministic fixture data. Dates are offsets from an anchor (start of the
// UTC day the run began) that globalSetup hands to the tests via `provide`.
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

const uuid = (kind: number, n: number) =>
  `a${kind.toString(16)}000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

export type Role = 'ADMIN' | 'MANAGER' | 'STAFF';
export type WorkshopStatus = 'SCHEDULED' | 'CANCELLED' | 'COMPLETED';
export type RegStatus = 'ACTIVE' | 'WAITLISTED' | 'CANCELLED';

export interface FxUser {
  key: string;
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
}

export const USERS = {
  admin: { key: 'admin', id: uuid(1, 1), email: 'admin@test.local', name: 'Test Admin', role: 'ADMIN', isActive: true },
  manager: { key: 'manager', id: uuid(1, 2), email: 'manager@test.local', name: 'Test Manager', role: 'MANAGER', isActive: true },
  staff: { key: 'staff', id: uuid(1, 3), email: 'staff@test.local', name: 'Test Staff', role: 'STAFF', isActive: true },
  inactive: { key: 'inactive', id: uuid(1, 4), email: 'inactive@test.local', name: 'Test Inactive', role: 'STAFF', isActive: false },
} as const satisfies Record<string, FxUser>;

export type UserKey = keyof typeof USERS;
export const ROLE_KEYS = ['admin', 'manager', 'staff'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export interface FxWorkshop {
  key: string;
  id: string;
  code: string;
  title: string;
  description: string | null;
  instructor: string;
  location: string;
  dayOffset: number;
  hour: number;
  durationHours: number;
  capacity: number;
  activeCount: number;
  status: WorkshopStatus;
}

const W = (n: number, w: Omit<FxWorkshop, 'id'>): FxWorkshop => ({ ...w, id: uuid(2, n) });

export const WORKSHOPS = {
  open: W(1, { key: 'open', code: 'FX-OPEN', title: 'Intro to Pottery', description: 'Wheel basics and glazing.', instructor: 'Hana Ito', location: 'Main Campus', dayOffset: 3, hour: 10, durationHours: 3, capacity: 10, activeCount: 2, status: 'SCHEDULED' }),
  full: W(2, { key: 'full', code: 'FX-FULL', title: 'Web Design Workshop', description: 'HTML, CSS and layout.', instructor: 'Dev Patel', location: 'City Centre', dayOffset: 4, hour: 14, durationHours: 2, capacity: 3, activeCount: 3, status: 'SCHEDULED' }),
  last: W(3, { key: 'last', code: 'FX-LAST', title: 'Morning Yoga Flow', description: 'Gentle stretching.', instructor: 'Maya Rao', location: 'Lakeside', dayOffset: 5, hour: 9, durationHours: 1, capacity: 2, activeCount: 1, status: 'SCHEDULED' }),
  empty: W(4, { key: 'empty', code: 'FX-EMPTY', title: 'Watercolour Painting', description: 'Landscapes in watercolour.', instructor: 'Lena Fox', location: 'Main Campus', dayOffset: 6, hour: 18, durationHours: 2, capacity: 5, activeCount: 0, status: 'SCHEDULED' }),
  far: W(5, { key: 'far', code: 'FX-FAR', title: 'Spreadsheet Skills', description: null, instructor: 'Ines Ortega', location: 'City Centre', dayOffset: 30, hour: 10, durationHours: 2, capacity: 20, activeCount: 0, status: 'SCHEDULED' }),
  cancelled: W(6, { key: 'cancelled', code: 'FX-CANC', title: 'Strength Circuit', description: 'Circuit training.', instructor: 'Omar Haddad', location: 'Lakeside', dayOffset: 7, hour: 13, durationHours: 1, capacity: 6, activeCount: 0, status: 'CANCELLED' }),
  completed: W(7, { key: 'completed', code: 'FX-DONE', title: 'Hand-Building Ceramics', description: 'Coil and slab.', instructor: 'Hana Ito', location: 'Main Campus', dayOffset: -5, hour: 10, durationHours: 3, capacity: 8, activeCount: 4, status: 'COMPLETED' }),
  pastScheduled: W(8, { key: 'pastScheduled', code: 'FX-PAST', title: 'Missed Session', description: 'Past but still scheduled.', instructor: 'Ines Ortega', location: 'City Centre', dayOffset: -2, hour: 10, durationHours: 2, capacity: 4, activeCount: 1, status: 'SCHEDULED' }),
} as const satisfies Record<string, FxWorkshop>;

export type WorkshopKey = keyof typeof WORKSHOPS;
export const ALL_WORKSHOPS: FxWorkshop[] = Object.values(WORKSHOPS);
export const FIXTURE_WORKSHOP_IDS = new Set(ALL_WORKSHOPS.map((w) => w.id));

export interface FxRegistration {
  id: string;
  workshop: WorkshopKey;
  name: string;
  email: string;
  status: RegStatus;
  /** minutes after the registration base time, keeps ordering deterministic */
  minute: number;
  registeredBy: UserKey;
  cancelledBy?: UserKey;
  cancelReason?: string;
}

let regN = 0;
const R = (
  workshop: WorkshopKey,
  name: string,
  status: RegStatus,
  extra: Partial<FxRegistration> = {},
): FxRegistration => {
  regN++;
  return {
    id: uuid(3, regN),
    workshop,
    name,
    email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`,
    status,
    minute: regN,
    registeredBy: 'staff',
    ...extra,
  };
};

export const REGISTRATIONS = {
  openAda: R('open', 'Ada Active', 'ACTIVE'),
  openBob: R('open', 'Bob Active', 'ACTIVE'),
  openCarl: R('open', 'Carl Cancelled', 'CANCELLED', { cancelledBy: 'staff', cancelReason: 'Changed plans' }),
  fullF1: R('full', 'Fay First', 'ACTIVE'),
  fullF2: R('full', 'Gus Second', 'ACTIVE'),
  fullF3: R('full', 'Hal Third', 'ACTIVE', { registeredBy: 'manager' }),
  fullW1: R('full', 'Wendy Waitlist', 'WAITLISTED'),
  fullW2: R('full', 'Walt Waitlist', 'WAITLISTED'),
  lastLou: R('last', 'Lou Last', 'ACTIVE'),
  doneD1: R('completed', 'Dee One', 'ACTIVE'),
  doneD2: R('completed', 'Dan Two', 'ACTIVE'),
  doneD3: R('completed', 'Dot Three', 'ACTIVE'),
  doneD4: R('completed', 'Dex Four', 'ACTIVE'),
  pastPat: R('pastScheduled', 'Pat Past', 'ACTIVE'),
} as const satisfies Record<string, FxRegistration>;

export const ALL_REGISTRATIONS: FxRegistration[] = Object.values(REGISTRATIONS);

export const when = (
  anchor: number,
  w: Pick<FxWorkshop, 'dayOffset' | 'hour' | 'durationHours'>,
) => {
  const startsAt = new Date(anchor + w.dayOffset * DAY + w.hour * HOUR);
  return { startsAt, endsAt: new Date(startsAt.getTime() + w.durationHours * HOUR) };
};
