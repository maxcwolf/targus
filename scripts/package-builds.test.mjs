// @ts-check
// Built packages run without the "development" condition, exactly as npm consumers get them
// (ADR 0010). `yarn check` runs `tsc -b` first; the build here is then an up-to-date no-op.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildPackages } from './lib/build-packages.mjs';
import {
  declarationFiles,
  publishedPackages,
  relativeTsSpecifiers,
} from './lib/declaration-specifiers.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const bin = path.join(repoRoot, 'packages/cli/dist/bin.js');
const unresolved = /ERR_MODULE_NOT_FOUND|Cannot find (?:package|module)/;

const relativeSpecifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"\n]+)['"]/g;

/** The declaration file a relative `.js`/`.mjs`/`.cjs` specifier in `file` resolves to. */
function declarationFor(/** @type {string} */ file, /** @type {string} */ specifier) {
  const target = path.resolve(path.dirname(file), specifier);
  return target.replace(/\.([mc]?)js$/, '.d.$1ts');
}

/**
 * @template T
 * @param {string} file
 * @returns {T}
 */
function readJson(file) {
  /** @type {unknown} */
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return /** @type {T} */ (parsed);
}

/**
 * The `scripts` of the package.json in `dir`.
 * @param {string} dir
 * @returns {Record<string, string>}
 */
function scriptsOf(dir) {
  /** @type {{ scripts: Record<string, string> }} */
  const manifest = readJson(path.join(repoRoot, dir, 'package.json'));
  return manifest.scripts;
}

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

describe('built declaration files', () => {
  // tsc keeps `./x.ts` in .d.ts output; consumers' tools that follow declarations
  // (dependency-cruiser) cannot resolve it. scripts/fix-declarations.mjs rewrites it (ADR 0034).
  it('import relative siblings by their emitted .js name, never .ts', () => {
    for (const pkg of publishedPackages) {
      const files = declarationFiles(path.join(repoRoot, pkg, 'dist'));
      assert.ok(files.length > 0, `${pkg} has no declaration files`);
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        assert.deepEqual(relativeTsSpecifiers(text), [], path.relative(repoRoot, file));
        for (const [, specifier = ''] of text.matchAll(relativeSpecifier)) {
          const target = declarationFor(file, specifier);
          assert.ok(existsSync(target), `${path.relative(repoRoot, file)}: ${specifier}`);
        }
      }
    }
  });

  it('have maps that name their declaration file and an existing source', () => {
    for (const pkg of publishedPackages) {
      for (const file of declarationFiles(path.join(repoRoot, pkg, 'dist'))) {
        /** @type {{ file: string, sources: string[] }} */
        const map = readJson(`${file}.map`);
        assert.equal(map.file, path.basename(file));
        for (const source of map.sources) {
          assert.ok(existsSync(path.resolve(path.dirname(file), source)), `${file}: ${source}`);
        }
      }
    }
  });

  it('are fixed by every script that emits a published dist/', () => {
    const fix = /&& node (?:\.\.\/\.\.\/)?scripts\/fix-declarations\.mjs\b/;
    assert.match(scriptsOf('.').typecheck ?? '', fix);
    for (const pkg of publishedPackages) {
      for (const [name, script] of Object.entries(scriptsOf(pkg))) {
        if (/\btsc -b\b/.test(script)) assert.match(script, fix, `${pkg} ${name}`);
      }
    }
  });
});
