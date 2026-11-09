import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createFakeClock,
  createFakeDeviceDriver,
  createFakeIdGenerator,
  type FakeDeviceDriver,
} from '@targus/core';
import { CommanderError } from 'commander';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Exec } from './adapters/exec.adapter.ts';
import type { GitMetadata } from './adapters/git.adapter.ts';
import { SimctlDriver } from './adapters/simctl.adapter.ts';
import { runRun, type RunCommandDeps } from './commands/run.ts';
import { loadConfig } from './config.ts';
import { failureExitCode, unauthorizedExitCode } from './errors/exit-codes.ts';
import { writeFixtureCapture } from './fixtures/fixture-capture.ts';
import { createProgram } from './program.ts';
import { createFakeTargusApi, type FakeTargusApi } from './run/targus-api.fake.ts';

/**
 * First-run mistakes in `targus run`, from argv and environment to exit code and stderr: each
 * must fail with plain words before anything slow happens (no simulator boot, no API call).
 */

const sha = 'a'.repeat(40);

const git: GitMetadata = {
  fetchBase: () => Promise.resolve(),
  headSha: () => Promise.resolve(sha),
  currentBranch: () => Promise.resolve('feature/button'),
  isShallow: () => Promise.resolve(false),
  resolveCommit: () => Promise.resolve(sha),
  mergeBase: () => Promise.resolve(sha),
  firstParentAncestors: () => Promise.resolve([]),
};

let api: FakeTargusApi;
let driver: FakeDeviceDriver;
let captures: number;
let simctl: string[][];

/** `xcrun simctl list devices --json` printing `stdout`; any other command fails the test. */
function simctlListing(stdout: string): Exec {
  return (file, args) => {
    simctl.push([file, ...args]);
    if (args.join(' ') !== 'simctl list devices --json') {
      return Promise.reject(new Error(`unexpected command: ${args.join(' ')}`));
    }
    return Promise.resolve({ stdout: Buffer.from(stdout), stderr: '' });
  };
}

function deps(listing = '{"devices":{}}'): RunCommandDeps {
  const exec = simctlListing(listing);
  return {
    exec,
    clock: createFakeClock(),
    ids: createFakeIdGenerator('run'),
    log: () => undefined,
    capture: () => {
      captures += 1;
      return driver.boot();
    },
    makeTempDir: () => Promise.resolve('/tmp/never-used'),
    createApi: () => api,
    createGit: () => git,
    captureWeb: () => Promise.reject(new Error('no web capture in this test')),
    loadProjectConfig: () => Promise.resolve(null),
    simulatorName: (udid, run) => new SimctlDriver({ udid, exec: run }).deviceName(),
    checkApp: () => Promise.resolve('co.example'),
  };
}

interface Outcome {
  readonly exitCode: number;
  readonly stderr: string;
}

async function targus(
  args: string[],
  env: Record<string, string>,
  runDeps: RunCommandDeps = deps(),
): Promise<Outcome> {
  let stderr = '';
  const program = createProgram({
    loadConfig: (overrides) => loadConfig({ TARGUS_TOKEN: 't', ...env }, overrides),
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

const simulatorRun = ['run', '--udid', 'SIM-1', '--app', 'build/ExampleApp.app'];
const hint =
  "  set --api-url or TARGUS_API_URL to the targus API's address, for example " +
  'https://targus.example.com\n';

beforeEach(() => {
  api = createFakeTargusApi();
  driver = createFakeDeviceDriver();
  captures = 0;
  simctl = [];
});

function expectNothingSlowRan(): void {
  expect(captures).toBe(0);
  expect(driver.calls).toEqual([]);
  expect(api.calls).toEqual([]);
}

describe('targus run with a bad API URL', () => {
  it('rejects a --api-url without a scheme before touching the simulator', async () => {
    const { exitCode, stderr } = await targus(
      [...simulatorRun, '--api-url', 'targus.example.com'],
      {},
    );

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toBe(
      'error: --api-url "targus.example.com" has no http:// or https:// scheme\n' + hint,
    );
    expectNothingSlowRan();
    expect(simctl).toEqual([]);
  });

  it('rejects a TARGUS_API_URL that is not a URL', async () => {
    const { exitCode, stderr } = await targus(simulatorRun, { TARGUS_API_URL: 'not a url' });

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toBe('error: TARGUS_API_URL "not a url" is not a URL\n' + hint);
    expectNothingSlowRan();
  });
});

describe('targus run with an API URL it accepts or masks', () => {
  it('never prints the password in a URL with credentials', async () => {
    const env = { TARGUS_API_URL: 'https://ci:not-a-real-password@targus.example.com' };
    const { exitCode, stderr } = await targus(simulatorRun, env);

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toBe(
      'error: TARGUS_API_URL "https://***@targus.example.com" contains a user name or ' +
        'password; the token belongs in TARGUS_TOKEN\n' +
        hint,
    );
    expect(stderr).not.toContain('not-a-real-password');
    expectNothingSlowRan();
  });

  it('lets a good --api-url win over a bad TARGUS_API_URL, without its trailing slash', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'targus-first-run-'));
    try {
      const capture = path.join(dir, 'capture');
      await writeFixtureCapture(capture);
      const urls: string[] = [];
      const runDeps = deps();
      const args = ['run', '--from-capture', capture, '--device-name', 'X'];
      const { exitCode } = await targus(
        [...args, '--api-url', 'https://targus.example.com/targus/'],
        { TARGUS_API_URL: 'not a url' },
        {
          ...runDeps,
          createApi: (baseUrl) => {
            urls.push(baseUrl);
            return api;
          },
        },
      );

      expect(exitCode).toBe(0);
      expect(urls).toEqual(['https://targus.example.com/targus']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('targus run with an empty token', () => {
  it('exits 3 and says the token is empty', async () => {
    const { exitCode, stderr } = await targus(simulatorRun, { TARGUS_TOKEN: '  ' });

    expect(exitCode).toBe(unauthorizedExitCode);
    expect(stderr).toBe('error: TARGUS_TOKEN is empty: export the project token\n');
    expectNothingSlowRan();
  });
});

describe('targus run when the simulator list cannot be read', () => {
  const tryThis =
    '  run `xcrun simctl list devices --json` yourself to see what it prints, check that ' +
    '`xcode-select -p` points at the Xcode you expect, or pass --device-name to skip the lookup\n';

  it.each([
    ['nothing', '', '`xcrun simctl list devices --json` printed nothing'],
    [
      'a warning before the JSON',
      'xcrun: warning: unable to find utility\n{"devices":{}}',
      'its output is not JSON (it starts with "xcrun: warning: unable to find utility")',
    ],
    [
      'JSON of another shape',
      '{"runtimes":[]}',
      'its JSON has no "devices" object mapping each runtime to a list of devices',
    ],
    [
      'a device without the expected keys',
      '{"devices":{"iOS-18-0":[{"uuid":"SIM-1"}]}}',
      'a device under "iOS-18-0" has no string "udid" and "name"',
    ],
  ])('says so plainly when simctl prints %s', async (_what, listing, reason) => {
    const { exitCode, stderr } = await targus(simulatorRun, {}, deps(listing));

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toBe(`error: could not read the simulator list: ${reason}\n${tryThis}`);
    expectNothingSlowRan();
  });

  it('names a UDID simctl does not list', async () => {
    const listing = JSON.stringify({ devices: { 'iOS-18-0': [{ udid: 'OTHER', name: 'X' }] } });
    const { exitCode, stderr } = await targus(simulatorRun, {}, deps(listing));

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toBe(
      'error: no simulator with UDID SIM-1 in `xcrun simctl list devices`: check --udid, ' +
        'or pass --device-name\n',
    );
    expectNothingSlowRan();
  });
});
