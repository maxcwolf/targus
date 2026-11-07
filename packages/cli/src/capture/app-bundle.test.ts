import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ExecError, type Exec } from '../adapters/exec.adapter.ts';
import { checkAppBundle } from './app-bundle.ts';

let dir: string;
let app: string;

/** An `Exec` that answers plutil with `stdout`, or fails with `error`. */
function plutil(answer: string | Error): Exec {
  return () =>
    answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve({ stdout: Buffer.from(answer), stderr: '' });
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'targus-app-bundle-'));
  app = path.join(dir, 'ExampleApp.app');
  await mkdir(app);
  await writeFile(path.join(app, 'Info.plist'), '<plist/>');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('checkAppBundle', () => {
  it("answers the plist's bundle id, or --bundle-id without reading the plist", async () => {
    expect(await checkAppBundle(app, { exec: plutil('co.example\n') })).toBe('co.example');
    const never = plutil(new Error('plutil should not run'));
    expect(await checkAppBundle(app, { exec: never, bundleId: 'co.given' })).toBe('co.given');
  });

  it('says so when plutil prints no bundle id', async () => {
    await expect(checkAppBundle(app, { exec: plutil('\n') })).rejects.toThrow(
      'its Info.plist has no CFBundleIdentifier',
    );
  });

  it('leaves a plutil that is not installed, and a path it cannot stat, to their own errors', async () => {
    const missing = new ExecError('plutil failed: spawn plutil ENOENT', '');
    await expect(checkAppBundle(app, { exec: plutil(missing) })).rejects.toBe(missing);

    const file = path.join(dir, 'file');
    await writeFile(file, '');
    await expect(
      checkAppBundle(path.join(file, 'X.app'), { exec: plutil('co.example') }),
    ).rejects.toMatchObject({ code: 'ENOTDIR' });
  });
});
