import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import {
  TEST_DATABASE_URL,
  TEST_JWT_SECRET,
  TEST_REDIS_URL,
  assertTestTargets,
} from './test-api/config.ts';

assertTestTargets();

export default defineConfig({
  // SWC emits decorator metadata, which Nest's dependency injection needs.
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: true,
    root: './',
    include: ['test-api/**/*.api-spec.ts'],
    globalSetup: ['./test-api/global-setup.ts'],
    // Files share one database; run them one at a time so counts are stable.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      JWT_SECRET: TEST_JWT_SECRET,
      THROTTLE_DISABLED: 'true',
      CORS_ORIGINS: 'http://localhost:5173',
    },
  },
});
