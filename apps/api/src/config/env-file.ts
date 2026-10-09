import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

export const APP_ENVS = ['development', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** APP_ENV from the real process environment, defaulting to "development". */
export function getAppEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.APP_ENV?.trim() || 'development';
}

/**
 * Repository root = nearest ancestor holding pnpm-workspace.yaml. Walks up from this
 * file (works from src/, dist/ and vitest) and falls back to cwd. In the Docker image
 * the workspace file exists but env/ does not; that is fine, the file is optional.
 */
export function findRepoRoot(startDirs: string[] = []): string {
  const starts = [dirname(fileURLToPath(import.meta.url)), process.cwd(), ...startDirs];
  for (const start of starts) {
    let dir = resolve(start);
    for (;;) {
      if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return resolve(process.cwd(), '../..');
}

/** Absolute path of env/.env.<APP_ENV> (may not exist). */
export function envFilePath(appEnv: string = getAppEnv()): string {
  return join(findRepoRoot(), 'env', `.env.${appEnv}`);
}

/** Path list for ConfigModule.forRoot({ envFilePath }). Missing files are ignored by Nest. */
export function envFilePaths(appEnv: string = getAppEnv()): string[] {
  return [envFilePath(appEnv)];
}

/** Plain dotenv load for non-Nest entry points (prisma config, seed). Process env wins. */
export function loadEnvFile(appEnv: string = getAppEnv()): void {
  const path = envFilePath(appEnv);
  if (existsSync(path)) loadDotenv({ path, quiet: true });
}
