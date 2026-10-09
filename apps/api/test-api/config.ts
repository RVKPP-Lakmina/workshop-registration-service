// Single source of truth for the dedicated API-test infrastructure.
// Never points at the dev database `workshop_registration` (guarded in assertTestTargets).
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://workshop_registration:workshop_registration@localhost:5434/workshop_registration_test?schema=public';
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6380/1';
export const TEST_JWT_SECRET = 'api-test-secret-0123456789abcdef0123456789';
export const TEST_PASSWORD = 'Passw0rd!test';

export function databaseName(url: string) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

export function assertTestTargets() {
  const db = databaseName(TEST_DATABASE_URL);
  if (!/test/i.test(db)) {
    throw new Error(`Refusing to run API tests against database "${db}": name must contain "test"`);
  }
  const redisDb = new URL(TEST_REDIS_URL).pathname.replace(/^\//, '') || '0';
  if (redisDb === '0') {
    throw new Error('Refusing to run API tests on Redis db 0: use a non-zero db index (default /1)');
  }
}
