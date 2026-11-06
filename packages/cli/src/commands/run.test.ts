import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createFakeClock, isTargusError } from '@targus/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Exec } from '../adapters/exec.adapter.js';
import type { GitMetadata } from '../adapters/git.adapter.js';
import type { CaptureCommandOptions } from './capture.js';
import { loadConfig, type CliConfig } from '../config.js';
import { fixtureCaptureReport, writeFixtureCapture } from '../fixtures/fixture-capture.js';
import { createFakeTargusApi, type FakeTargusApi } from '../run/targus-api.fake.js';
import { runRun, type RunCommandDeps, type RunCommandOptions } from './run.js';

const head = 'a'.repeat(40);
const mergeBase = 'b'.repeat(40);
const ancestor = 'c'.repeat(40);

function fakeGit(overrides: Partial<GitMetadata> = {}): GitMetadata {
  return {
    fetchBase: () => Promise.resolve(),
    headSha: () => Promise.resolve(head),
    currentBranch: () => Promise.resolve('feature/button'),
    isShallow: () => Promise.resolve(false),
    resolveCommit: (ref) => Promise.resolve(ref === 'origin/main' ? mergeBase : null),
    mergeBase: (ref) => Promise.resolve(ref === 'origin/main' ? mergeBase : null),
    firstParentAncestors: () => Promise.resolve([ancestor]),
    ...overrides,
  };
}

let dir: string;
let api: FakeTargusApi;
let lines: string[];
let captures: CaptureCommandOptions[];

function deps(overrides: Partial<RunCommandDeps> = {}): RunCommandDeps {
  const exec: Exec = () => Promise.reject(new Error('no exec in tests'));
  return {
    exec,
    clock: createFakeClock(),
    log: (line) => lines.push(line),
    capture: async (options) => {
      captures.push(options);
      await writeFixtureCapture(options.out);
    },
    makeTempDir: () => Promise.resolve(path.join(dir, 'tmp-capture')),
    createApi: () => api,
    createGit: () => fakeGit(),
    simulatorName: () => Promise.resolve('iPhone 16'),
    ...overrides,
  };
}

function options(overrides: Partial<RunCommandOptions> = {}): RunCommandOptions {
  return {
    apiUrl: 'http://localhost:8787',
    baseBranch: 'main',
    threshold: 0.001,
    port: 7007,
    settle: 300,
    stabilityGap: 150,
    renderTimeout: 10000,
    connectTimeout: 60000,
    attempts: 3,
    ...overrides,
  };
}

const config: CliConfig = { ...loadConfig({}), token: 'tok', ci: {} };

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (isTargusError(error)) return `${error.code}: ${error.message}`;
    throw error;
  }
  return 'resolved';
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'targus-run-test-'));
  api = createFakeTargusApi();
  lines = [];
  captures = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runRun --from-capture', () => {
  it('publishes a previous capture without touching the simulator', async () => {
    const capture = path.join(dir, 'capture');
    await writeFixtureCapture(capture);

    const output = await runRun(
      options({ fromCapture: capture, deviceName: 'iPhone 16 Pro' }),
      {
        ...config,
        ci: { CIRCLE_BRANCH: 'feature/x', CIRCLE_PULL_REQUEST: 'https://github.com/o/r/pull/5' },
      },
      deps({ simulatorName: () => Promise.reject(new Error('should not be called')) }),
    );

    expect(captures).toEqual([]);
    expect(api.callsOf('createBuild')[0]?.request).toMatchObject({
      sha: head,
      branch: 'feature/x',
      prNumber: 5,
      mergeBaseSha: mergeBase,
      ancestors: [ancestor],
      trigger: 'pr',
      device: 'iPhone 16 Pro',
    });
    expect(api.callsOf('uploadImage')).toHaveLength(3);
    expect(output.counts.new).toBe(3);
    expect(lines).toContain('review: https://targus.test/builds/build-1');
    expect(lines).toContain('check run: 1');
    expect(lines.some((line) => /^ {2}new +3$/.test(line))).toBe(true);
  });
});

describe('runRun --sha', () => {
  it('opens the build on --sha', async () => {
    const capture = path.join(dir, 'capture');
    await writeFixtureCapture(capture);
    const override = 'e'.repeat(40);

    await runRun(
      options({ fromCapture: capture, deviceName: 'X', branch: 'main', sha: override }),
      config,
      deps(),
    );

    expect(api.callsOf('createBuild')[0]?.request.sha).toBe(override);
    expect(lines[1]).toBe('build: build-1');
  });
});

describe('runRun --from-capture against baselines', () => {
  it('diffs against baselines the fake server holds', async () => {
    const capture = path.join(dir, 'capture');
    await writeFixtureCapture(capture);
    const [red, blue] = fixtureCaptureReport().stories;
    if (red?.png == null || blue?.png == null) throw new Error('fixture lost its PNGs');
    api = createFakeTargusApi({
      baselines: { 'fixture-solid--red': red.png, 'fixture-solid--blue': red.png },
      checkRunId: null,
    });

    const output = await runRun(
      options({ fromCapture: capture, deviceName: 'iPhone 16' }),
      config,
      deps(),
    );

    expect(output.results.map((result) => [result.storyId, result.state])).toEqual([
      ['fixture-solid--red', 'unchanged'],
      ['fixture-solid--blue', 'changed'],
      ['fixture-gradient--default', 'new'],
    ]);
    expect(lines).toContain('check run: none (the project has no GitHub App installation)');
  });
});

describe('runRun capturing', () => {
  it('captures into a temp directory and names the device from the simulator', async () => {
    await runRun(options({ udid: 'SIM', app: 'Example.app', limit: 2 }), config, deps());

    expect(captures).toEqual([
      expect.objectContaining({
        udid: 'SIM',
        app: 'Example.app',
        out: path.join(dir, 'tmp-capture'),
        limit: 2,
      }),
    ]);
    expect(api.callsOf('createBuild')[0]?.request.device).toBe('iPhone 16');
  });

  it('uses --out and bundle and filter flags', async () => {
    const out = path.join(dir, 'out');

    await runRun(
      options({
        udid: 'SIM',
        app: 'A.app',
        out,
        bundleId: 'co.x',
        filter: 'solid',
        deviceName: 'X',
      }),
      config,
      deps(),
    );

    expect(captures[0]).toMatchObject({ out, bundleId: 'co.x', filter: 'solid' });
  });
});

describe('runRun failures', () => {
  it('needs a token, an app or a capture, a device and a branch', async () => {
    expect(await codeOf(runRun(options(), { ...config, token: undefined }, deps()))).toMatch(
      /^unauthorized: TARGUS_TOKEN/,
    );
    expect(await codeOf(runRun(options({ deviceName: 'X' }), config, deps()))).toMatch(
      /^bad_request: pass --udid and --app/,
    );
    expect(await codeOf(runRun(options({ fromCapture: dir }), config, deps()))).toMatch(
      /--device-name/,
    );
    const detached = deps({
      createGit: () => fakeGit({ currentBranch: () => Promise.resolve(null) }),
    });
    expect(await codeOf(runRun(options({ fromCapture: dir }), config, detached))).toMatch(
      /--branch/,
    );
  });

  it('fails when the simulator name is unknown', async () => {
    const unknown = deps({ simulatorName: () => Promise.resolve(null) });

    expect(await codeOf(runRun(options({ udid: 'SIM', app: 'A.app' }), config, unknown))).toMatch(
      /--device-name/,
    );
    expect(captures).toEqual([]);
  });

  it('stops on a shallow clone before capturing', async () => {
    const shallow = deps({ createGit: () => fakeGit({ isShallow: () => Promise.resolve(true) }) });

    expect(await codeOf(runRun(options({ udid: 'SIM', app: 'A.app' }), config, shallow))).toMatch(
      /^bad_request: this checkout is a shallow clone.*fetch-depth: 0/,
    );
    expect(captures).toEqual([]);
  });

  it('logs a failed fetch and goes on with the local base branch', async () => {
    const offline = fakeGit({ fetchBase: () => Promise.reject(new Error('no network')) });

    await runRun(
      options({ udid: 'SIM', app: 'A.app', deviceName: 'X' }),
      config,
      deps({ createGit: () => offline }),
    );

    expect(lines[0]).toMatch(/^warning: could not fetch main from origin; using origin\/main/);
  });
});
