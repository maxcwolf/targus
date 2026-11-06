// @ts-check
// Built packages run without the "development" condition, exactly as npm consumers get them
// (ADR 0010). `yarn check` runs `tsc -b` first; the build here is then an up-to-date no-op.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildPackages } from './lib/build-packages.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const bin = path.join(repoRoot, 'packages/cli/dist/bin.js');
const unresolved = /ERR_MODULE_NOT_FOUND|Cannot find (?:package|module)/;

/** @param {string[]} args */
function node(args) {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

before(async () => {
  const build = await buildPackages(['packages/cli', 'packages/react-native']);
  assert.equal(build.status, 0, build.output);
});

describe('built packages', () => {
  it('resolve to dist/ without the development condition', () => {
    for (const name of ['@targus/core', '@targus/cli', '@targus/react-native']) {
      const resolved = fileURLToPath(import.meta.resolve(name));
      assert.match(resolved, /\/packages\/[^/]+\/dist\/index\.js$/, name);
    }
  });

  it('resolve @targus/core/browser to dist/browser.js, loadable without pngjs (ADR 0025)', async () => {
    const resolved = fileURLToPath(import.meta.resolve('@targus/core/browser'));
    assert.match(resolved, /\/packages\/core\/dist\/browser\.js$/);

    const browser = await import('@targus/core/browser');
    assert.equal(typeof browser.needsReview, 'function');
    assert.ok(!('diffImages' in browser));
  });

  it('runs `targus --version` from dist/bin.js', () => {
    const result = node([bin, '--version']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it('loads the capture and compare commands from dist/bin.js', () => {
    // --help loads the whole command graph (ws, core's diffImages) without touching a device.
    for (const command of ['capture', 'compare']) {
      const result = node([bin, command, '--help']);

      assert.doesNotMatch(result.stderr, unresolved);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, command === 'capture' ? /--udid <id>/ : /--baseline <dir>/);
    }
  });
});
