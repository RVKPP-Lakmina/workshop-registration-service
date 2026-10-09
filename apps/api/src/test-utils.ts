import { expect } from 'vitest';

/** Awaits `p`, asserts it rejects with an AppError-shaped HttpException. */
export async function expectAppError(
  p: Promise<unknown>,
  status: number,
  code: string,
) {
  const err = (await p.then(
    () => {
      throw new Error('expected promise to reject');
    },
    (e: unknown) => e,
  )) as { getStatus?: () => number; getResponse?: () => unknown };
  expect(err.getStatus?.()).toBe(status);
  expect(err.getResponse?.()).toMatchObject({ statusCode: status, code });
}

/** ExecutionContext stub exposing a request plus handler/class refs. */
export function makeCtx(req: Record<string, unknown>, handler = () => {}, cls = class {}) {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}
