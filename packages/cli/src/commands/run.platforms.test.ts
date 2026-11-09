import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createFakeClock, createFakeIdGenerator, isTargusError } from '@targus/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { GitMetadata } from '../adapters/git.adapter.ts';
import { writeCaptureOutput } from '../capture/manifest.ts';
import { loadConfig, type CliConfig } from '../config.ts';
import { fixtureCaptureReport, writeFixtureCapture } from '../fixtures/fixture-capture.ts';
import type { ProjectConfig } from '../project-config.ts';
import { createFakeTargusApi, type FakeTargusApi } from '../run/targus-api.fake.ts';
import type { WebCaptureOptions } from './capture-web.ts';
import { runRun, type RunCommandDeps, type RunCommandOptions } from './run.ts';

const head = 'a'.repeat(40);
const mergeBase = 'b'.repeat(40);

const git: GitMetadata = {
  fetchBase: () => Promise.resolve(),
  headSha: () => Promise.resolve(head),
  currentBranch: () => Promise.resolve('feature/web'),
  isShallow: () => Promise.resolve(false),
  resolveCommit: () => Promise.resolve(mergeBase),
  mergeBase: () => Promise.resolve(mergeBase),
  firstParentAncestors: () => Promise.resolve([]),
};

let dir: string;
let api: FakeTargusApi;
let lines: string[];
let webCaptures: WebCaptureOptions[];
let iosCaptures: string[];

async function writeWebCapture(out: string, pixelRatio = 1): Promise<void> {
  await writeCaptureOutput(out, fixtureCaptureReport(), {
    platform: 'web',
    browser: 'chromium 141.0.1',
    storybook: 'storybook-static',
    viewport: { width: 1200, height: 900 },
    pixelRatio,
    settleMs: 300,
    stabilityGapMs: 150,
  });
}

function deps(projectConfig: ProjectConfig | null, overrides: Partial<RunCommandDeps> = {}) {
  let temp = 0;
  const value: RunCommandDeps = {
    exec: () => Promise.reject(new Error('no exec in tests')),
    clock: createFakeClock(),
    ids: createFakeIdGenerator('run'),
    log: (line) => lines.push(line),
    capture: async (options) => {
      iosCaptures.push(options.out);
      await writeFixtureCapture(options.out, 'base', options.appearance);
    },
    captureWeb: async (options) => {
      webCaptures.push(options);
      await writeWebCapture(options.out, options.pixelRatio);
    },
    makeTempDir: () => Promise.resolve(path.join(dir, `tmp-${(temp += 1)}`)),
    createApi: () => api,
    createGit: () => git,
    simulatorName: () => Promise.resolve('iPhone 16'),
    checkApp: () => Promise.resolve('co.example'),
    loadProjectConfig: () => Promise.resolve(projectConfig),
    ...overrides,
  };
  return value;
}

function options(overrides: Partial<RunCommandOptions> = {}): RunCommandOptions {
  return {
    apiUrl: 'http://localhost:8787',
    baseBranch: 'main',
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

const both: ProjectConfig = {
  platforms: {
    ios: { app: '/repo/App.app', udid: 'SIM' },
    web: { storybook: '/repo/storybook-static', pixelRatio: 2 },
  },
};

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return isTargusError(error) || error instanceof Error ? error.message : String(error);
  }
  return 'resolved';
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'targus-run-platforms-'));
  api = createFakeTargusApi();
  lines = [];
  webCaptures = [];
  iosCaptures = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runRun --platform web', () => {
  it('captures the Storybook and opens a web build named after the browser', async () => {
    const outputs = await runRun(
      options({ platforms: ['web'], storybook: 'sb', limit: 1, filter: 'red' }),
      config,
      deps(null),
    );
    expect(outputs).toHaveLength(1);
    expect(webCaptures).toEqual([
      expect.objectContaining({
        storybook: 'sb',
        viewport: { width: 1200, height: 900 },
        pixelRatio: 1,
        limit: 1,
        filter: 'red',
        out: path.join(dir, 'tmp-1'),
      }),
    ]);
    expect(api.callsOf('createBuild')[0]?.request).toMatchObject({
      platform: 'web',
      pixelRatio: 1,
      device: 'chromium 141.0.1',
      appearance: null,
    });
    expect(lines).not.toContain('== web ==');
  });

  it('names the device with --device-name instead', async () => {
    await runRun(
      options({ platforms: ['web'], storybook: 'sb', deviceName: 'Chrome desktop' }),
      config,
      deps(null),
    );
    expect(api.callsOf('createBuild')[0]?.request.device).toBe('Chrome desktop');
  });
});

describe('runRun with both platforms', () => {
  it('captures and publishes each configured platform as its own build', async () => {
    const outputs = await runRun(options({ out: path.join(dir, 'out') }), config, deps(both));
    expect(outputs).toHaveLength(2);
    expect(iosCaptures).toEqual([path.join(dir, 'out', 'ios')]);
    expect(webCaptures.map((capture) => capture.out)).toEqual([path.join(dir, 'out', 'web')]);
    expect(api.callsOf('createBuild').map((call) => call.request.platform)).toEqual(['ios', 'web']);
    expect(api.callsOf('createBuild')[1]?.request).toMatchObject({ pixelRatio: 2 });
    expect(lines).toContain('== ios ==');
    expect(lines).toContain('== web ==');
    expect((await readdir(path.join(dir, 'out'))).sort()).toEqual(['ios', 'web']);
  });

  it('publishes the other platform when one fails, then fails with the first error', async () => {
    const failingIos = deps(both, { capture: () => Promise.reject(new Error('simulator broke')) });
    expect(await messageOf(runRun(options(), config, failingIos))).toBe('simulator broke');
    expect(lines).toContain('ios failed: simulator broke');
    expect(api.callsOf('createBuild').map((call) => call.request.platform)).toEqual(['web']);
  });

  it('checks every platform before capturing any', async () => {
    const noSimulator = deps(both, { simulatorName: () => Promise.resolve(null) });
    expect(await messageOf(runRun(options(), config, noSimulator))).toMatch(
      /^no simulator with UDID SIM/,
    );
    expect(webCaptures).toEqual([]);
    expect(api.callsOf('createBuild')).toEqual([]);
  });
});

describe('runRun --from-capture of a web capture', () => {
  it('takes the platform, device and pixel ratio from the manifest', async () => {
    const capture = path.join(dir, 'web-capture');
    await writeWebCapture(capture, 2);
    await runRun(options({ fromCapture: capture }), config, deps(null));
    expect(api.callsOf('createBuild')[0]?.request).toMatchObject({
      platform: 'web',
      device: 'chromium 141.0.1',
      pixelRatio: 2,
    });
  });

  it('refuses a capture of another platform than --platform asks for', async () => {
    const capture = path.join(dir, 'web-capture');
    await writeWebCapture(capture);
    expect(
      await messageOf(
        runRun(options({ fromCapture: capture, platforms: ['ios'] }), config, deps(null)),
      ),
    ).toBe(`${capture} holds a web capture, not ios: check --platform`);
  });
});
