import { basename, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { envFilePath, envFilePaths, findRepoRoot, getAppEnv } from './env-file.js';

describe('env file resolution', () => {
  it('defaults APP_ENV to development', () => {
    expect(getAppEnv({})).toBe('development');
    expect(getAppEnv({ APP_ENV: 'staging' })).toBe('staging');
  });

  it('points at <repo>/env/.env.<APP_ENV>', () => {
    const p = envFilePath('staging');
    expect(basename(p)).toBe('.env.staging');
    expect(basename(dirname(p))).toBe('env');
    expect(dirname(dirname(p))).toBe(findRepoRoot());
    expect(envFilePaths('production')).toEqual([envFilePath('production')]);
  });
});
