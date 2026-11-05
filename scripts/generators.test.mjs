// @ts-check
// Runs the generators as `yarn new:*` would, in a throwaway directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const scriptsDir = import.meta.dirname;
/** @type {string} */
let root = '';

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'targus-scaffold-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * @param {string} script
 * @param {string[]} args
 */
function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(scriptsDir, script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** @param {string} file */
function read(file) {
  return readFileSync(path.join(root, file), 'utf8');
}

describe('yarn new:route', () => {
  it('creates a route and its test in apps/api/src/routes', () => {
    const result = run('new-route.mjs', ['builds']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /created apps\/api\/src\/routes\/builds\.ts/);
    assert.match(result.stdout, /app\.route\('\/api\/builds', buildsRoute\)/);
    assert.match(
      read('apps/api/src/routes/builds.ts'),
      /export const buildsRoute = new Hono<AppEnv>\(\)/,
    );
    assert.match(read('apps/api/src/routes/builds.test.ts'), /from '\.\/builds\.js'/);
  });

  it('refuses names that are not kebab-case', () => {
    const result = run('new-route.mjs', ['Builds']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /must be kebab-case/);
  });

  it('refuses to overwrite an existing route', () => {
    assert.equal(run('new-route.mjs', ['builds']).status, 0);
    const second = run('new-route.mjs', ['builds']);

    assert.equal(second.status, 1);
    assert.match(second.stderr, /refusing to overwrite/);
  });

  it('prints usage without a name', () => {
    assert.match(run('new-route.mjs', []).stderr, /usage: yarn new:route <name>/);
  });
});

describe('yarn new:adapter', () => {
  it('puts an api-side adapter in the layer that owns its port', () => {
    const result = run('new-adapter.mjs', ['image-store', 'r2']);

    assert.equal(result.status, 0, result.stderr);
    const source = read('apps/api/src/storage/r2-image-store.adapter.ts');
    assert.match(source, /import type \{ ImageStore \} from '@targus\/core'/);
    assert.match(source, /export function createR2ImageStore\(\): ImageStore/);
    assert.match(read('apps/api/src/storage/r2-image-store.adapter.test.ts'), /createR2ImageStore/);
  });

  it('puts a cli-side adapter in packages/cli without touching its manifest', () => {
    const result = run('new-adapter.mjs', ['device-driver', 'simctl']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      read('packages/cli/src/adapters/simctl-device-driver.adapter.ts'),
      /SimctlDeviceDriver/,
    );
    assert.equal(
      result.stdout.trim(),
      [
        'created packages/cli/src/adapters/simctl-device-driver.adapter.ts',
        'created packages/cli/src/adapters/simctl-device-driver.adapter.test.ts',
      ].join('\n'),
    );
  });

  it('honours --in for ports that both sides implement', () => {
    const result = run('new-adapter.mjs', ['clock', 'system', '--in', 'cli']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      read('packages/cli/src/adapters/system-clock.adapter.ts'),
      /createSystemClock\(\): Clock/,
    );
  });

  it('rejects unknown ports and targets', () => {
    assert.match(run('new-adapter.mjs', ['printer', 'laser']).stderr, /unknown port "printer"/);
    assert.match(run('new-adapter.mjs', ['clock', 'system', '--in', 'web']).stderr, /--in must be/);
    assert.match(run('new-adapter.mjs', ['clock']).stderr, /usage: yarn new:adapter/);
  });
});
