import { loadEnvFile } from './src/config/env-file.js';
import { defineConfig } from 'prisma/config';

// env/.env.<APP_ENV> (process env wins; no-op in Docker where env arrives via compose)
loadEnvFile();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
