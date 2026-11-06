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
import { encodeSolidPng } from '../capture/solid-png.fake.ts';
import {
  defaultCaptureDeps,
  formatCaptureSummary,
  readBundleId,
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
  };
}

function options(overrides: Partial<CaptureCommandOptions> = {}): CaptureCommandOptions {
  return {
    udid: 'SIM',
    app: '/apps/Example.app',
    out: path.join(dir, 'out'),
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
    expect(driver.calls.slice(0, 4)).toEqual(preparedDevice);
    expect(manifest.summary).toMatchObject({
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
    expect(manifest.summary.app.bundleId).toBe('co.given');
  });
});

describe('runCapture failures', () => {
  it('closes the channel when the device fails', async () => {
    driver.boot = () => Promise.reject(new Error('boot failed'));

    await expect(runCapture(options(), deps())).rejects.toThrow('boot failed');
    expect(channel.closed).toBe(true);
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
