#!/usr/bin/env node
// Copies env/.env.<name>.example -> env/.env.<name> when missing. Never overwrites.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const envDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'env');
for (const name of ['development', 'staging', 'production']) {
  const src = join(envDir, `.env.${name}.example`);
  const dest = join(envDir, `.env.${name}`);
  if (existsSync(dest)) {
    console.log(`exists   env/.env.${name} (left untouched)`);
    continue;
  }
  copyFileSync(src, dest);
  console.log(`created  env/.env.${name}`);
  if (name !== 'development') {
    console.warn(
      `\n!!! WARNING: env/.env.${name} was created from a template containing CHANGE_ME_* placeholders.\n` +
        `!!! You MUST replace JWT_SECRET, POSTGRES_PASSWORD / DATABASE_URL and CORS_ORIGINS before using ${name}.\n` +
        `!!! The API will refuse to start in ${name} until you do.\n`,
    );
  }
}
