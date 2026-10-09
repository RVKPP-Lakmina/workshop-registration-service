#!/usr/bin/env node
// Usage: node scripts/compose.mjs [--dev] <docker compose args...>
// Picks env/.env.$APP_ENV (APP_ENV defaults to development) and runs
// `docker compose --env-file <file> [-f docker-compose.dev.yml] <args>`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dev = args[0] === '--dev';
if (dev) args.shift();

const appEnv = process.env.APP_ENV || 'development';
if (!['development', 'staging', 'production'].includes(appEnv)) {
  console.error(`APP_ENV must be development, staging or production (got "${appEnv}")`);
  process.exit(1);
}
const envFile = join(root, 'env', `.env.${appEnv}`);
if (!existsSync(envFile)) {
  console.error(`Missing env/.env.${appEnv}. Run \`pnpm env:init\` and edit the file.`);
  process.exit(1);
}
const file = dev ? 'docker-compose.dev.yml' : 'docker-compose.yml';
const res = spawnSync(
  'docker',
  ['compose', '--env-file', envFile, '-f', join(root, file), ...args],
  { stdio: 'inherit', cwd: root, env: { ...process.env, APP_ENV: appEnv } },
);
process.exit(res.status ?? 1);
