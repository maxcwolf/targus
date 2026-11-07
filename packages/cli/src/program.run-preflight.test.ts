import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createFakeClock, createFakeDeviceDriver, type FakeDeviceDriver } from '@targus/core';
import { CommanderError } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TargusApiClient, type Fetch } from './adapters/api-client.adapter.ts';
import { ExecError, type Exec } from './adapters/exec.adapter.ts';
import type { GitMetadata } from './adapters/git.adapter.ts';
import { defaultRunDeps, runRun, type RunCommandDeps } from './commands/run.ts';
import { loadConfig } from './config.ts';
import { failureExitCode, unauthorizedExitCode } from './errors/exit-codes.ts';
import { createProgram } from './program.ts';
import { createFakeTargusApi, type FakeTargusApi } from './run/targus-api.fake.ts';

/**
 * The checks `targus run` makes before anything slow, from argv to exit code and stderr: a bad
 * `--app`, and a token the API rejects. Each fails in plain words before the git work, the
 * simulator and (for `--app`) any API call.
 */

const sha = 'a'.repeat(40);
const apiUrl = 'https://targus.example.com';

let dir: string;
let api: FakeTargusApi;
let driver: FakeDeviceDriver;
let captures: number;
let gitCalls: number;
let commands: string[][];

/** git that counts its calls, so a test can say the git work never started. */
function countingGit(): GitMetadata {
  const answer = <T>(value: T) => {
    gitCalls += 1;
    return Promise.resolve(value);
  };
  return {
    fetchBase: () => answer(undefined),
    headSha: () => answer(sha),
    currentBranch: () => answer('feature/button'),
    isShallow: () => answer(false),
    resolveCommit: () => answer(sha),
    mergeBase: () => answer(sha),
    firstParentAncestors: () => answer([]),
  };
}

const listing = JSON.stringify({ devices: { 'iOS-18-0': [{ udid: 'SIM-1', name: 'iPhone 16' }] } });

/** simctl lists SIM-1; plutil prints `plutil` (or fails as plutil does when it is an error). */
function exec(plutil: string | ExecError): Exec {
  return (file, args) => {
    commands.push([file, ...args]);
    if (file === 'plutil') {
      if (plutil instanceof ExecError) return Promise.reject(plutil);
      return Promise.resolve({ stdout: Buffer.from(plutil), stderr: '' });
    }
    return Promise.resolve({ stdout: Buffer.from(listing), stderr: '' });
  };
}

/** The real run deps, with the simulator, git and the capture faked. */
function deps(overrides: Partial<RunCommandDeps> = {}): RunCommandDeps {
  return {
    ...defaultRunDeps,
    exec: exec('co.example.exampleapp\n'),
    clock: createFakeClock(),
    log: () => undefined,
    capture: () => {
      captures += 1;
      return driver.boot();
    },
    makeTempDir: () => Promise.resolve(path.join(dir, 'never-used')),
    createApi: () => api,
    createGit: countingGit,
    ...overrides,
  };
}

async function targus(args: string[], runDeps: RunCommandDeps) {
  let stderr = '';
  const program = createProgram({
    loadConfig: (overrides) =>
      loadConfig({ TARGUS_TOKEN: 'not-the-project-token', TARGUS_API_URL: apiUrl }, overrides),
    debug: false,
    runners: { run: (options, config) => runRun(options, config, runDeps) },
  });
  for (const command of [program, ...program.commands]) {
    command.exitOverride().configureOutput({
      writeOut: () => undefined,
      writeErr: (text) => (stderr += text),
    });
  }
  try {
    await program.parseAsync(args, { from: 'user' });
    return { exitCode: 0, stderr };
  } catch (error) {
    if (error instanceof CommanderError) return { exitCode: error.exitCode, stderr };
    throw error;
  }
}

/** A directory that looks like a simulator build: `ExampleApp.app/Info.plist`. */
async function appBundle(): Promise<string> {
  const app = path.join(dir, 'ExampleApp.app');
  await mkdir(app);
  await writeFile(path.join(app, 'Info.plist'), '<plist/>');
  return app;
}

const run = (app: string) => ['run', '--udid', 'SIM-1', '--app', app];
const buildHint = 'pass the .app directory built for the iOS simulator';

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'targus-preflight-'));
  api = createFakeTargusApi();
  driver = createFakeDeviceDriver();
  captures = 0;
  gitCalls = 0;
  commands = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function expectNothingSlowRan(apiCalls: readonly unknown[] = []): void {
  expect(captures).toBe(0);
  expect(driver.calls).toEqual([]);
  expect(gitCalls).toBe(0);
  expect(api.calls).toEqual(apiCalls);
}

describe('targus run with a bad --app', () => {
  it('names an --app that does not exist', async () => {
    const app = path.join(dir, 'Missing.app');
    const { exitCode, stderr } = await targus(run(app), deps());

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toBe(`error: --app ${app} does not exist: ${buildHint}\n`);
    expectNothingSlowRan();
  });

  it('names an --app that is a file, such as an .ipa', async () => {
    const app = path.join(dir, 'ExampleApp.ipa');
    await writeFile(app, 'zip');
    const { exitCode, stderr } = await targus(run(app), deps());

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toBe(`error: --app ${app} is not a directory: ${buildHint}\n`);
    expectNothingSlowRan();
  });

  it('names an --app without an Info.plist, even with --bundle-id', async () => {
    const app = path.join(dir, 'Empty.app');
    await mkdir(app);
    const args = [...run(app), '--bundle-id', 'co.example.exampleapp'];
    const { exitCode, stderr } = await targus(args, deps());

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toBe(`error: --app ${app} has no Info.plist: ${buildHint}\n`);
    expectNothingSlowRan();
  });

  it('names an Info.plist with no bundle id', async () => {
    const app = await appBundle();
    const refused = new ExecError('plutil failed', 'Could not extract value, error: No value');
    const { exitCode, stderr } = await targus(run(app), deps({ exec: exec(refused) }));

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toBe(
      `error: --app ${app}: its Info.plist has no CFBundleIdentifier: ${buildHint}, ` +
        'or pass --bundle-id\n',
    );
    expectNothingSlowRan();
  });

  it('reads the bundle id once and hands it to the capture', async () => {
    const app = await appBundle();
    const bundleIds: (string | undefined)[] = [];
    const runDeps = deps({
      capture: (options) => {
        bundleIds.push(options.bundleId);
        return Promise.reject(new Error('stop after the checks'));
      },
    });

    await targus(run(app), runDeps);

    expect(bundleIds).toEqual(['co.example.exampleapp']);
    expect(commands.filter(([file]) => file === 'plutil')).toHaveLength(1);
  });
});

/** The real API client against a server that answers every request with `response`. */
function answering(status: number, body: unknown): Partial<RunCommandDeps> {
  const fetch: Fetch = () => Promise.resolve(Response.json(body, { status }));
  return {
    createApi: (baseUrl, token) =>
      new TargusApiClient({ baseUrl, token, fetch, sleep: () => Promise.resolve() }),
  };
}

describe('targus run with a token or URL the API rejects', () => {
  it('exits 3 naming TARGUS_TOKEN when the API answers 401, before git and the capture', async () => {
    const body = {
      error: { code: 'unauthorized', message: 'invalid project token', requestId: 'r-1' },
    };
    const { exitCode, stderr } = await targus(run(await appBundle()), deps(answering(401, body)));

    expect(exitCode).toBe(unauthorizedExitCode);
    expect(stderr).toBe(
      `error: the targus API at ${apiUrl} rejected TARGUS_TOKEN: export the token printed when ` +
        'the project was created (a revoked token, or one whose project was deleted, is ' +
        'rejected) (request id: r-1)\n',
    );
    expectNothingSlowRan();
  });

  it('exits 1 saying the URL may not be the targus API when the route is missing', async () => {
    const body = { error: { code: 'not_found', message: 'no route', requestId: 'r-2' } };
    const { exitCode, stderr } = await targus(run(await appBundle()), deps(answering(404, body)));

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toBe(
      `error: ${apiUrl} does not answer GET /api/projects/current: check that --api-url or ` +
        'TARGUS_API_URL is the targus API, and that it runs a version as new as this CLI ' +
        '(request id: r-2)\n',
    );
    expectNothingSlowRan();
  });

  it('prints the project and goes on when the API knows the token', async () => {
    const lines: string[] = [];
    const runDeps = deps({
      log: (line) => lines.push(line),
      capture: () => Promise.reject(new Error('stop after the checks')),
    });

    await targus(run(await appBundle()), runDeps);

    expect(lines[0]).toBe('project: the pilot app (example-org/example-app)');
    expect(api.calls).toEqual([{ method: 'currentProject' }]);
    expect(gitCalls).toBeGreaterThan(0);
  });
});
