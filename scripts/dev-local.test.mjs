// @ts-check
// `yarn dev:local` (e2e/local.ts) without a human: start it on its own ports, wait until it
// prints its sign-in help, check the Worker answers signed out and that the GitHub stub signs
// octocat in to the seeded project, then Ctrl-C it and check nothing is left listening.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { buildPackages } from './lib/build-packages.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

/**
 * Two ports the OS reports free right now, held open together so they differ. Free ports, not
 * fixed ones, let several `yarn check` runs (in one worktree or many) run this test at once.
 */
async function freePorts() {
  const servers = [createServer(), createServer()];
  const ports = await Promise.all(
    servers.map(
      (server) =>
        /** @type {Promise<number>} */ (
          new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
              const address = server.address();
              resolve(typeof address === 'object' && address !== null ? address.port : 0);
            });
          })
        ),
    ),
  );
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
    ),
  );
  return ports;
}

const [port = 0, stubPort = 0] = await freePorts();
const api = `http://127.0.0.1:${port}`;

/** @type {import('node:child_process').ChildProcess | null} */
let child = null;
let output = '';

/** @param {import('node:child_process').ChildProcess} proc */
function exited(proc) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) resolve(proc.exitCode);
    else
      proc.once('exit', (code) => {
        resolve(code);
      });
  });
}

/** @param {number} p */
function listening(p) {
  return new Promise((resolve) => {
    const socket = createConnection({ port: p, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

/** @param {import('node:child_process').ChildProcess} proc */
function ready(proc) {
  return new Promise((resolve, reject) => {
    proc.stdout?.on('data', (chunk) => {
      output += String(chunk);
      if (output.includes('Press Ctrl-C to stop')) resolve(undefined);
    });
    proc.stderr?.on('data', (chunk) => {
      output += String(chunk);
    });
    proc.once('exit', (code) => {
      reject(new Error(`exited ${String(code)} early:\n${output}`));
    });
  });
}

/** The cookie a response sets, as a `Cookie` header value. @param {Response} response */
function cookieOf(response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

/** Sign in through the stub by hand and return the session cookie. */
async function signIn() {
  const start = await fetch(`${api}/api/auth/github?returnTo=/`, { redirect: 'manual' });
  const authorize = await fetch(start.headers.get('location') ?? '', { redirect: 'manual' });
  const callback = await fetch(authorize.headers.get('location') ?? '', {
    redirect: 'manual',
    headers: { cookie: cookieOf(start) },
  });
  assert.equal(callback.status, 302);
  return cookieOf(callback);
}

before(async () => {
  // `yarn dev:local` builds the CLI first; `yarn check` has built it already (tsc -b).
  const build = await buildPackages(['packages/cli']);
  assert.equal(build.status, 0, build.output);
});

after(async () => {
  if (child !== null && child.exitCode === null) {
    child.kill('SIGINT');
    await exited(child);
  }
  // The command's D1, R2 and UI build for this port (e2e/local.ts).
  rmSync(path.join(repoRoot, 'e2e', '.wrangler', `local-${port}`), {
    recursive: true,
    force: true,
  });
});

describe('yarn dev:local', () => {
  it(
    'serves a seeded review UI behind the GitHub stub and stops on Ctrl-C',
    { timeout: 300_000 },
    async (t) => {
      t.diagnostic(`worker port ${String(port)}, stub port ${String(stubPort)}`);
      const args = ['--port', String(port), '--github-stub-port', String(stubPort)];
      child = spawn(
        process.execPath,
        [
          '--experimental-strip-types',
          '--disable-warning=ExperimentalWarning',
          'e2e/local.ts',
          ...args,
        ],
        { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      await ready(child);
      assert.match(output, new RegExp(`Open +${api}`));
      assert.match(output, /signs you in as octocat/);
      assert.match(output, new RegExp(`127\\.0\\.0\\.1:${stubPort}/__next-login`));

      const health = await fetch(`${api}/api/health`);
      assert.equal(health.status, 200);
      assert.equal((await fetch(`${api}/api/me`)).status, 401);

      const cookie = await signIn();
      const me = await (await fetch(`${api}/api/me`, { headers: { cookie } })).text();
      assert.match(me, /"login":"octocat"/);
      const projects = await (await fetch(`${api}/api/projects`, { headers: { cookie } })).text();
      assert.match(projects, /targus-local\/demo/);
      // The seeded builds: an accepted main build, and a PR build that has it as its baseline.
      const projectId = /"projects":\[\{"id":"([^"]+)"/.exec(projects)?.[1] ?? '';
      const builds = await (
        await fetch(`${api}/api/projects/${projectId}/builds`, { headers: { cookie } })
      ).text();
      assert.match(builds, /"status":"accepted"/);
      assert.match(builds, /"baselineBuildId":"[^"]+"/);

      child.kill('SIGINT');
      assert.equal(await exited(child), 0, output);
      assert.equal(await listening(port), false, 'the Worker still listens');
      assert.equal(await listening(stubPort), false, 'the GitHub stub still listens');
    },
  );
});
