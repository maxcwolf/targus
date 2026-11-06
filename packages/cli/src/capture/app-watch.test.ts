import {
  createFakeDeviceDriver,
  createFakeStorybookChannel,
  isTargusError,
  type DeviceDriver,
  type FakeDeviceDriver,
  type FakeStorybookChannel,
} from '@targus/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppExitedError, crashReportDir, whileAppRuns, type AppWatch } from './app-watch.ts';
import type { CaptureProgress } from './capture-stories.ts';

let driver: FakeDeviceDriver;
let channel: FakeStorybookChannel;

beforeEach(() => {
  driver = createFakeDeviceDriver();
  channel = createFakeStorybookChannel();
});

function watch<T>(work: (watch: AppWatch) => Promise<T>, watched: DeviceDriver = driver) {
  return whileAppRuns({ driver: watched, channel, bundleId: 'co.example', pollMs: 5 }, work);
}

const never = new Promise<never>(() => undefined);

function progress(index: number, total: number): CaptureProgress {
  const result = { id: `story-${index}` } as CaptureProgress['result'];
  return { index, total, result };
}

describe('whileAppRuns', () => {
  it('returns what the work returns and aborts the signal afterwards', async () => {
    let signal: AbortSignal | undefined;

    const value = await watch((w) => {
      signal = w.signal;
      return Promise.resolve(42);
    });

    expect(value).toBe(42);
    expect(signal?.aborted).toBe(true);
  });

  it('fails at once when the app exits before any story, naming the crash report folder', async () => {
    const run = watch(() => never);
    driver.exitApp();

    await expect(run).rejects.toBeInstanceOf(AppExitedError);
    await expect(run).rejects.toSatisfy(isTargusError);
    await expect(run).rejects.toThrow(
      `the app co.example exited before any story was captured, probably a crash at launch: ` +
        `look for its crash report in ${crashReportDir}`,
    );
  });

  it('says how far the capture got when the app exits mid-run', async () => {
    const run = watch(({ onProgress }) => {
      onProgress(progress(0, 5));
      onProgress(progress(1, 5));
      driver.exitApp();
      return never;
    });

    await expect(run).rejects.toThrow(
      'the app co.example exited after 2 of 5 stories, probably a crash: look for its crash ' +
        `report in ${crashReportDir}; the partial capture was discarded`,
    );
  });
});

describe('whileAppRuns when the channel drops', () => {
  it('reports a disconnect when the process is still running', async () => {
    const run = watch(({ onProgress }) => {
      onProgress(progress(0, 3));
      channel.disconnect();
      return never;
    });

    await expect(run).rejects.toThrow(
      'the app co.example closed its Storybook channel connection after 1 of 3 stories; ' +
        'the partial capture was discarded',
    );
  });

  it('reports an exit when the process is gone too', async () => {
    const run = watch(() => {
      driver.exitApp();
      channel.disconnect();
      return never;
    });

    await expect(run).rejects.toMatchObject({ how: 'exited', count: { done: 0, total: null } });
  });

  it('treats a driver that cannot answer as a running app', async () => {
    const unsure: DeviceDriver = {
      ...driver,
      isAppRunning: () => Promise.reject(new Error('simctl hung')),
    };
    const run = watch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      channel.disconnect();
      return never;
    }, unsure);

    await expect(run).rejects.toThrow(
      'the app co.example closed its Storybook channel connection before any story was captured',
    );
  });
});

describe('whileAppRuns polling', () => {
  it('lets the work finish while every check finds the app running', async () => {
    const value = await watch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return 'done';
    });

    expect(value).toBe('done');
  });

  it('does not start a check while the previous one is still running', async () => {
    let checks = 0;
    let answer: (running: boolean) => void = () => undefined;
    const slow: DeviceDriver = {
      ...driver,
      isAppRunning: () => {
        checks += 1;
        return new Promise((resolve) => (answer = resolve));
      },
    };
    const run = watch(() => never, slow);

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(checks).toBe(1);
    answer(false);

    await expect(run).rejects.toMatchObject({ how: 'exited' });
  });
});
