import { expect } from 'vitest';
import { ISO_RE, UUID_RE } from './helpers.ts';

export const USER_KEYS = ['createdAt', 'email', 'id', 'isActive', 'name', 'role', 'updatedAt'];
export const WORKSHOP_KEYS = [
  'activeCount', 'capacity', 'code', 'createdAt', 'createdById', 'description', 'endsAt', 'id',
  'instructor', 'location', 'seatsLeft', 'startsAt', 'status', 'title', 'updatedAt', 'updatedById',
];
export const REGISTRATION_KEYS = [
  'attendeeEmail', 'attendeeName', 'cancelReason', 'cancelledAt', 'cancelledById', 'id', 'promotedAt',
  'registeredAt', 'registeredById', 'status', 'workshopId',
];
export const REGISTRATION_LIST_KEYS = [...REGISTRATION_KEYS, 'cancelledBy', 'registeredBy'];

export const keysOf = (o: object) => Object.keys(o).sort();

export function expectUserShape(u: Record<string, unknown>) {
  expect(keysOf(u)).toEqual(USER_KEYS);
  expect(u.id).toMatch(UUID_RE);
  expect(u.createdAt).toMatch(ISO_RE);
  expect(u.updatedAt).toMatch(ISO_RE);
  expect(typeof u.isActive).toBe('boolean');
}

export function expectWorkshopShape(w: Record<string, unknown>) {
  expect(keysOf(w)).toEqual(WORKSHOP_KEYS);
  expect(w.id).toMatch(UUID_RE);
  expect(w.startsAt).toMatch(ISO_RE);
  expect(w.endsAt).toMatch(ISO_RE);
  expect(w.createdAt).toMatch(ISO_RE);
  expect(w.seatsLeft).toBe(Math.max((w.capacity as number) - (w.activeCount as number), 0));
}

export function expectRegistrationShape(r: Record<string, unknown>, keys = REGISTRATION_KEYS) {
  expect(keysOf(r)).toEqual([...keys].sort());
  expect(r.id).toMatch(UUID_RE);
  expect(r.registeredAt).toMatch(ISO_RE);
}
