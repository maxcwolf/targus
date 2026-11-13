// @ts-check
// Runs the generators as `yarn new:*` would: in a throwaway directory for their behaviour, and
// in the real tree for their output, which must pass the same checks as hand-written code.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { generateAndCheck, removeProbeLeftovers } from './lib/check-generated.mjs';
import { appFile, registerRoute, unregisterRoute } from './lib/register-route.mjs';

const scriptsDir = import.meta.dirname;
const repoRoot = path.join(scriptsDir, '..');
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

/** Put a copy of the real app.ts in the scratch root. */
function copyAppTs() {
  mkdirSync(path.join(root, path.dirname(appFile)), { recursive: true });
  writeFileSync(path.join(root, appFile), readFileSync(path.join(repoRoot, appFile), 'utf8'));
}

describe('yarn new:route', () => {
  it('creates a route behind the session and its test in apps/api/src/routes', () => {
    const result = run('new-route.mjs', ['builds']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /created apps\/api\/src\/routes\/builds\.ts/);
    assert.match(result.stdout, /apps\/api\/src\/services\/index\.ts/);
    const source = read('apps/api/src/routes/builds.ts');
    assert.match(source, /export const buildsRoute = new Hono<AppEnv>\(\)\.get\('\/', sessionAuth/);
    assert.doesNotMatch(source, /repositories/);
    const test = read('apps/api/src/routes/builds.test.ts');
    assert.match(test, /from '\.\.\/\.\.\/test\/support\/api\.ts'/);
    assert.match(test, /withCookie\(cookie\)/);
    assert.match(test, /route: '\/api\/builds',\n\s+principal: 'reviewer'/);
  });
});

describe('yarn new:route mounting', () => {
  it('mounts the route in app.ts, the import in name order and the mount last', () => {
    copyAppTs();
    const lastMount = read(appFile)
      .split('\n')
      .findLast((line) => line.startsWith('  app.route('));

    const result = run('new-route.mjs', ['ledger']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mounted it in apps\/api\/src\/app\.ts at \/api\/ledger/);
    const app = read(appFile);
    assert.match(
      app,
      /from '\.\/routes\/installations\.ts';\nimport \{ ledgerRoute \} from '\.\/routes\/ledger\.ts';\nimport \{ meRoute \}/,
    );
    assert.ok(app.includes(`${lastMount ?? ''}\n  app.route('/api/ledger', ledgerRoute);\n`));
  });

  it('prints the lines to add instead when told not to mount, or when there is no app.ts', () => {
    copyAppTs();
    const before = read(appFile);

    const result = run('new-route.mjs', ['ledger', '--no-register']);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(read(appFile), before);
    assert.match(result.stdout, /not mounted: add to apps\/api\/src\/app\.ts/);
    assert.match(result.stdout, /import \{ ledgerRoute \} from '\.\/routes\/ledger\.ts';/);
    assert.match(result.stdout, /app\.route\('\/api\/ledger', ledgerRoute\);/);
    rmSync(path.join(root, appFile));
    assert.match(run('new-route.mjs', ['other']).stdout, /not mounted/);
  });
});

describe('yarn new:route arguments', () => {
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

describe('registerRoute', () => {
  it('leaves an app.ts it does not recognise, or one that already has the route, alone', () => {
    assert.equal(registerRoute('export const app = 1;\n', 'ledger', 'ledgerRoute'), null);
    const app = readFileSync(path.join(repoRoot, appFile), 'utf8');
    assert.equal(registerRoute(app, 'me', 'meRoute'), null);
  });

  it('undoes its own edit', () => {
    const app = readFileSync(path.join(repoRoot, appFile), 'utf8');
    const mounted = registerRoute(app, 'ledger', 'ledgerRoute') ?? '';

    assert.equal(unregisterRoute(mounted, 'ledger'), app);
    assert.equal(unregisterRoute(app, 'ledger'), app);
  });
});

describe('yarn new:adapter', () => {
  it('puts an image store in apps/api/src/storage, with no Cloudflare type in it', () => {
    const result = run('new-adapter.mjs', ['image-store', 's3']);

    assert.equal(result.status, 0, result.stderr);
    const source = read('apps/api/src/storage/s3-image-store.ts');
    assert.match(source, /import \{ TargusError, type ImageStore \} from '@targus\/core'/);
    assert.match(source, /export class S3ImageStore implements ImageStore/);
    assert.match(source, /constructor\(\{ endpoint, metadata, fetch: fetchImpl = fetch \}/);
    assert.doesNotMatch(source, /R2Bucket|cloudflare/);
    for (const method of ['missing', 'put', 'get']) {
      assert.match(source, new RegExp(`\\n {2}${method}\\(\\) \\{\\n {4}return Promise\\.reject`));
    }
    const test = read('apps/api/src/storage/s3-image-store.test.ts');
    assert.doesNotMatch(test, /cloudflare:workers|env\./);
    const steps = result.stdout.replaceAll(/\s+/g, ' ');
    assert.ok(steps.includes('createCloudflareStorage in apps/api/src/cloudflare/worker-deps.ts'));
    assert.ok(steps.includes('createAppDeps in apps/api/src/composition.ts'));
  });

  it('makes a build repository implement the API superset of the port', () => {
    const result = run('new-adapter.mjs', ['build-repository', 'd1']);

    assert.equal(result.status, 0, result.stderr);
    const source = read('apps/api/src/repositories/d1-build.repository.ts');
    assert.match(
      source,
      /import type \{ ApiBuildRepository \} from '\.\.\/ports\/build-repository\.ts'/,
    );
    assert.match(source, /export class D1BuildRepository implements ApiBuildRepository/);
    assert.match(source, /\n {2}commitReview\(\) \{/);
  });

  it('puts a cli-side adapter in packages/cli, starting subprocesses through Exec', () => {
    const result = run('new-adapter.mjs', ['device-driver', 'simctl']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      read('packages/cli/src/adapters/simctl-device-driver.adapter.ts'),
      /import \{ execFileBuffer, type Exec \} from '\.\/exec\.adapter\.ts'/,
    );
    const created = [
      'created packages/cli/src/adapters/simctl-device-driver.adapter.ts',
      'created packages/cli/src/adapters/simctl-device-driver.adapter.test.ts',
      'next:',
    ];
    assert.ok(result.stdout.startsWith(created.join('\n')), result.stdout);
    assert.match(result.stdout, /createDriver in packages\/cli\/src\/commands\/capture\.ts/);
  });
});

describe('yarn new:adapter arguments', () => {
  it('honours --in for ports that both sides implement, and only for those', () => {
    const result = run('new-adapter.mjs', ['clock', 'system', '--in', 'cli']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      read('packages/cli/src/adapters/system-clock.adapter.ts'),
      /export const systemClock: Clock = \{\n {2}now\(\) \{\n {4}throw notImplemented/,
    );
    assert.match(
      run('new-adapter.mjs', ['image-store', 'disk', '--in', 'cli']).stderr,
      /image-store adapters live only in api/,
    );
  });

  it('rejects unknown ports and targets', () => {
    assert.match(run('new-adapter.mjs', ['printer', 'laser']).stderr, /unknown port "printer"/);
    assert.match(run('new-adapter.mjs', ['clock', 'system', '--in', 'web']).stderr, /--in must be/);
    assert.match(run('new-adapter.mjs', ['clock']).stderr, /usage: yarn new:adapter/);
  });
});

describe('generated output', () => {
  // One of each kind in the layer it belongs to, checked together so the type-checks and the
  // lint run once. The route is not mounted in the real app.ts; a copy of app.ts with the
  // generator's edit is checked beside it, which also fails once app.ts changes shape.
  it('type-checks, lints and is formatted for every port and the route', async () => {
    const name = 'generator-probe';
    const ports = ['device-driver', 'storybook-channel', 'image-store', 'build-repository'];
    const both = ['clock', 'id-generator'];
    const adapters = [...ports, 'github-client', ...both].map((port) => [port, name]);
    const cli = both.map((port) => [port, name, '--in', 'cli']);
    removeProbeLeftovers(name, [
      'apps/api/src',
      'apps/api/src/routes',
      'apps/api/src/adapters',
      'apps/api/src/storage',
      'apps/api/src/repositories',
      'packages/cli/src/adapters',
    ]);
    const app = readFileSync(path.join(repoRoot, appFile), 'utf8');
    const mounted = registerRoute(app, name, 'generatorProbeRoute');
    assert.notEqual(mounted, null, `${appFile} no longer has the shape new-route.mjs mounts in`);

    const result = await generateAndCheck({
      runs: [
        { script: 'new-route.mjs', args: [name, '--no-register'] },
        ...[...adapters, ...cli].map((args) => ({ script: 'new-adapter.mjs', args })),
      ],
      tsconfigs: [
        'apps/api/tsconfig.worker.json',
        'packages/cli/tsconfig.lib.json',
        'packages/cli/tsconfig.test.json',
      ],
      extra: [{ path: `apps/api/src/${name}-app.ts`, content: mounted ?? '' }],
    });

    assert.equal(result.failures.join('\n'), '');
    assert.equal(result.files.length, 2 + (adapters.length + cli.length) * 2 + 1);
    assert.ok(result.files.every((file) => !existsSync(path.join(repoRoot, file))));
  });
});
