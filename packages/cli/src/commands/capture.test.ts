import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createFakeClock,
  createFakeDeviceDriver,
  createFakeStorybookChannel,
  type FakeDeviceDriver,
  type FakeStorybookChannel,
} from '@targus/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Exec } from '../adapters/exec.adapter.ts';
import { readBundleId } from '../capture/app-bundle.ts';
import { encodeSolidPng } from '../capture/solid-png.fake.ts';
import {
  defaultCaptureDeps,
  formatCaptureSummary,
  runCapture,
  type CaptureCommandDeps,
  type CaptureCommandOptions,
} from './capture.ts';

const white = encodeSolidPng(2, 2, [255, 255, 255, 255]);
const black = encodeSolidPng(2, 2, [0, 0, 0, 255]);
const index = [
  { id: 'a--one', title: 'A', name: 'One' },
  { id: 'b--two', title: 'B', name: 'Two' },
  { id: 'c--three', title: 'C', name: 'Three' },
];

const preparedDevice = [
  { method: 'boot' },
  { method: 'silenceSystemNotices' },
  { method: 'setAppearance', appearance: 'light' },
  { method: 'setContentSize', contentSize: 'large' },
  { method: 'setStatusBar', overrides: { time: '9:41', batteryLevel: 100, cellularBars: 4 } },
  { method: 'install', appPath: '/apps/Example.app' },
  { method: 'launch', bundleId: 'co.example.app', env: {} },
];

let dir: string;
let driver: FakeDeviceDriver;
let channel: FakeStorybookChannel;
let lines: string[];
let execCalls: (readonly string[])[];

function deps(plutilOutput = 'co.example.app\n'): CaptureCommandDeps {
  const clock = createFakeClock();
  const exec: Exec = (file, args) => {
    execCalls.push([file, ...args]);
    return Promise.resolve({ stdout: Buffer.from(plutilOutput), stderr: '' });
  };
  return {
    exec,
    clock,
    sleep: (ms) => {
      clock.advance(ms);
      return Promise.resolve();
    },
    log: (line) => lines.push(line),
    openChannel: () => Promise.resolve(channel),
    createDriver: () => driver,
    appPollMs: 5,
  };
}

function options(overrides: Partial<CaptureCommandOptions> = {}): CaptureCommandOptions {
  return {
    udid: 'SIM',
    app: '/apps/Example.app',
    out: path.join(dir, 'out'),
    appearance: 'light',
    port: 7007,
    settle: 300,
    stabilityGap: 150,
    renderTimeout: 10000,
    attempts: 2,
    connectTimeout: 60000,
    ...overrides,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'targus-capture-'));
  driver = createFakeDeviceDriver();
  channel = createFakeStorybookChannel(index);
  lines = [];
  execCalls = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runCapture', () => {
  it('prepares the device, captures every story and writes the output', async () => {
    channel.setOutcome('c--three', { kind: 'error', message: 'No QueryClient set' });
    // a: stable white. b: never settles (white/black twice).
    driver.queueScreenshots(white, white, white, black, black, white);

    const manifest = await runCapture(options(), deps());

    expect(execCalls).toEqual([
      [
        'plutil',
        '-extract',
        'CFBundleIdentifier',
        'raw',
        '-o',
        '-',
        '/apps/Example.app/Info.plist',
      ],
    ]);
    expect(driver.calls.slice(0, preparedDevice.length)).toEqual(preparedDevice);
    expect(manifest.summary).toMatchObject({
      device: { udid: 'SIM', appearance: 'light' },
      app: { bundleId: 'co.example.app', path: '/apps/Example.app' },
      storyCount: 3,
      captured: 2,
      failed: 1,
      unstable: ['b--two'],
      blank: ['a--one', 'b--two'],
    });
    expect((await readdir(path.join(dir, 'out'))).sort()).toEqual([
      'a--one.png',
      'b--two.png',
      'manifest.json',
    ]);
    expect(lines).toContain('1/3 a--one render=0ms total=450ms');
    expect(lines.some((line) => line.startsWith('3/3 c--three ERROR No QueryClient'))).toBe(true);
    expect(lines).toContain('unstable (1): b--two');
    expect(channel.closed).toBe(true);
  });

  it('uses --bundle-id, --filter and --limit when given', async () => {
    driver.queueScreenshots(white);

    const manifest = await runCapture(
      options({ bundleId: 'co.given', filter: 'B', limit: 1 }),
      deps(),
    );

    expect(execCalls).toEqual([]);
    expect(channel.selected).toEqual(['b--two']);
    expect(manifest.summary.app?.bundleId).toBe('co.given');
  });
});

describe('runCapture with parameters.targus', () => {
  it('lists a skipped story without capturing it or counting it as failed', async () => {
    channel.setOutcome('a--one', { kind: 'rendered', parameters: { delay: null, skip: true } });
    channel.setOutcome('b--two', { kind: 'rendered', parameters: { delay: 1000, skip: false } });
    driver.queueScreenshots(white, white, black, black);

    const manifest = await runCapture(options(), deps());

    expect(manifest.summary).toMatchObject({
      storyCount: 2,
      captured: 2,
      failed: 0,
      skipped: ['a--one'],
    });
    expect(manifest.stories.map((story) => story.id)).toEqual(['b--two', 'c--three']);
    expect(lines).toContain('1/3 a--one SKIPPED (parameters.targus.skip)');
    expect(lines).toContain('2/3 b--two render=0ms total=1150ms');
    expect(lines).toContain('skipped (1): a--one');
  });
});

describe('runCapture failures', () => {
  it('closes the channel when the device fails', async () => {
    driver.boot = () => Promise.reject(new Error('boot failed'));

    await expect(runCapture(options(), deps())).rejects.toThrow('boot failed');
    expect(channel.closed).toBe(true);
  });
});

describe('runCapture when the app crashes', () => {
  it('stops at once when the app exits at launch, and writes nothing', async () => {
    // Like the real channel when nothing connects: the index never arrives.
    channel.getIndex = () => new Promise(() => undefined);
    const launch = driver.launch.bind(driver);
    driver.launch = async (bundleId, env) => {
      await launch(bundleId, env);
      driver.exitApp();
    };

    await expect(runCapture(options(), deps())).rejects.toThrow(
      'the app co.example.app exited before any story was captured, probably a crash at launch',
    );
    await expect(readdir(path.join(dir, 'out'))).rejects.toThrow('ENOENT');
    expect(channel.closed).toBe(true);
  });

  it('stops at the story where the app drops the channel, and writes nothing', async () => {
    channel.setOutcome('b--two', { kind: 'disconnect' });
    driver.queueScreenshots(white);

    await expect(runCapture(options(), deps())).rejects.toThrow(
      'the app co.example.app closed its Storybook channel connection after 1 of 3 stories; ' +
        'the partial capture was discarded',
    );
    expect(channel.selected).toEqual(['a--one', 'b--two']);
    expect(lines.filter((line) => /^\d\/3 /.test(line))).toEqual([
      '1/3 a--one render=0ms total=450ms',
    ]);
    await expect(readdir(path.join(dir, 'out'))).rejects.toThrow('ENOENT');
    expect(channel.closed).toBe(true);
  });

  it('polls once a second unless told otherwise', async () => {
    const { exec, clock, sleep, log, openChannel, createDriver } = deps();
    const unset: CaptureCommandDeps = { exec, clock, sleep, log, openChannel, createDriver };
    driver.queueScreenshots(white);

    const manifest = await runCapture(options({ limit: 1 }), unset);

    expect(manifest.summary.captured).toBe(1);
  });
});

describe('readBundleId', () => {
  it('rejects an app without a bundle id', async () => {
    await expect(readBundleId(deps('\n').exec, '/apps/Empty.app')).rejects.toThrow(
      'no CFBundleIdentifier',
    );
  });
});

describe('formatCaptureSummary', () => {
  it('prints "none" when nothing is unstable and skips timings with no captures', async () => {
    channel = createFakeStorybookChannel([]);
    const manifest = await runCapture(options(), deps());

    expect(formatCaptureSummary(manifest)).toEqual([
      'captured 0/0 stories in 0.0s',
      'failed: 0',
      'unstable (0): none',
    ]);
  });
});

describe('defaultCaptureDeps', () => {
  it('wires the real driver, clock and sleep', async () => {
    const real = defaultCaptureDeps.createDriver('SIM', defaultCaptureDeps.exec);
    const before = defaultCaptureDeps.clock.now().getTime();
    await defaultCaptureDeps.sleep(1);

    expect(real.constructor.name).toBe('SimctlDriver');
    expect(defaultCaptureDeps.clock.now().getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('runCapture --appearance', () => {
  it('pins the --appearance before the app launches and records it', async () => {
    driver.queueScreenshots(white);

    const manifest = await runCapture(options({ appearance: 'dark', limit: 1 }), deps());

    const methods = driver.calls.map((call) => call.method);
    expect(driver.calls).toContainEqual({ method: 'setAppearance', appearance: 'dark' });
    expect(methods.indexOf('setAppearance')).toBeLessThan(methods.indexOf('launch'));
    expect(manifest.summary.device.appearance).toBe('dark');
    expect(lines[0]).toMatch(/ in dark mode$/);
  });
});
