import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

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
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'src/auth/**/*.ts',
        'src/audit/audit.service.ts',
        'src/common/**/*.ts',
        'src/users/users.service.ts',
        'src/workshops/workshops.service.ts',
        'src/registrations/*.service.ts',
        'src/registrations/waitlist.ts',
      ],
      exclude: ['**/*.spec.ts', '**/*.module.ts', '**/*.controller.ts', 'src/generated/**'],
    },
  },
});
