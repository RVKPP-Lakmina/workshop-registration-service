#!/usr/bin/env node
// Cross-platform "APP_ENV=<env> <command>":  node scripts/with-env.mjs staging pnpm db:migrate
import { spawnSync } from 'node:child_process';

const [appEnv, cmd, ...rest] = process.argv.slice(2);
if (!appEnv || !cmd) {
  console.error('usage: node scripts/with-env.mjs <development|staging|production> <command> [args...]');
  process.exit(1);
}
const res = spawnSync(cmd, rest, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, APP_ENV: appEnv },
});
process.exit(res.status ?? 1);
