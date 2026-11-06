import {
  createFakeClock,
  createFakeDeviceDriver,
  createFakeStorybookChannel,
  type StoryIndexEntry,
} from '@targus/core';
import { describe, expect, it } from 'vitest';

import {
  captureStories,
  selectStories,
  type CaptureOptions,
  type CaptureProgress,
  type CompareImages,
} from './capture-stories.ts';
import { encodeSolidPng } from './solid-png.fake.ts';

const index: StoryIndexEntry[] = [
  { id: 'button--primary', title: 'UI/Button', name: 'Primary' },
  { id: 'button--loading', title: 'UI/Button', name: 'Loading' },
  { id: 'chat--mine', title: 'Chat/Message', name: 'Mine' },
];

const options: CaptureOptions = {
  settleMs: 300,
  stabilityGapMs: 150,
  renderTimeoutMs: 10000,
  maxAttempts: 3,
};

const frameA = encodeSolidPng(4, 8, [255, 255, 255, 255]);
const frameB = encodeSolidPng(4, 8, [0, 0, 0, 255]);

/** Hash by identity of content: equal bytes give equal strings. */
const hash = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

function setup(compareImages: CompareImages = () => ({ ratio: 0.5, diffPng: null })) {
  const clock = createFakeClock();
  const channel = createFakeStorybookChannel(index);
  const driver = createFakeDeviceDriver();
  const sleeps: number[] = [];
  const compared: number[] = [];
  const progress: CaptureProgress[] = [];
  const sleep = (ms: number): Promise<void> => {
    sleeps.push(ms);
    clock.advance(ms);
    return Promise.resolve();
  };
  const input = {
    channel,
    driver,
    options,
    clock,
    sleep,
    hash,
    compareImages: (a: Uint8Array, b: Uint8Array) => {
      compared.push(1);
      return compareImages(a, b);
    },
    onProgress: (event: CaptureProgress) => progress.push(event),
  };
  return { clock, channel, driver, sleeps, compared, progress, input };
}

describe('captureStories', () => {
  it('captures a stable story once, from the app index, with size and timings', async () => {
    const { driver, sleeps, compared, progress, input } = setup();
    driver.queueScreenshots(frameA, frameA);

    const report = await captureStories({ ...input, options: { ...options, limit: 1 } });

    expect(report.startedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(report.durationMs).toBe(450);
    expect(report.stories).toEqual([
      {
        id: 'button--primary',
        title: 'UI/Button',
        name: 'Primary',
        png: frameA,
        hash: hash(frameA),
        width: 4,
        height: 8,
        renderMs: 0,
        captureMs: 450,
        attempts: 1,
        stable: true,
        blank: null,
        error: null,
      },
    ]);
    expect(sleeps).toEqual([300, 150]);
    expect(compared).toHaveLength(0);
    expect(progress).toEqual([{ index: 0, total: 1, result: report.stories[0], skipped: false }]);
    expect(report.skipped).toEqual([]);
  });

  it('retries with a doubled settle and marks a story unstable when captures keep differing', async () => {
    const { driver, sleeps, compared, input } = setup();
    driver.queueScreenshots(frameA, frameB, frameB, frameA, frameA, frameB);

    const report = await captureStories({ ...input, stories: index.slice(1, 2) });

    expect(report.stories[0]).toMatchObject({
      attempts: 3,
      stable: false,
      png: frameA,
      error: null,
    });
    expect(sleeps).toEqual([300, 150, 600, 150, 1200, 150]);
    expect(compared).toHaveLength(3);
  });
});

describe('captureStories stability', () => {
  it('settles on a later attempt when the pixels stop changing', async () => {
    const { driver, input } = setup();
    driver.queueScreenshots(frameA, frameB, frameB, frameB);

    const report = await captureStories({ ...input, options: { ...options, limit: 1 } });

    expect(report.stories[0]).toMatchObject({ attempts: 2, stable: true, png: frameB });
  });

  it('treats differing bytes with identical pixels as stable', async () => {
    const { driver, compared, input } = setup(() => ({ ratio: 0, diffPng: null }));
    driver.queueScreenshots(frameA, frameB);

    const report = await captureStories({ ...input, options: { ...options, limit: 1 } });

    expect(report.stories[0]).toMatchObject({ attempts: 1, stable: true });
    expect(compared).toHaveLength(1);
  });
});

describe('captureStories failures', () => {
  it('records a story error from the channel without a PNG', async () => {
    const { channel, driver, input } = setup();
    channel.setOutcome('button--primary', { kind: 'error', message: 'No QueryClient set' });

    const report = await captureStories({ ...input, options: { ...options, limit: 1 } });

    expect(report.stories[0]).toMatchObject({
      id: 'button--primary',
      png: null,
      hash: null,
      error: 'No QueryClient set',
      attempts: 0,
    });
    expect(driver.calls).toHaveLength(0);
  });

  it('records a render timeout as an error and carries on with the next story', async () => {
    const { channel, driver, input } = setup();
    channel.setOutcome('button--primary', { kind: 'timeout' });
    driver.queueScreenshots(frameA);

    const report = await captureStories(input);

    expect(report.stories.map((story) => story.error)).toEqual([
      'timeout after 10000ms waiting for button--primary',
      null,
      null,
    ]);
    expect(channel.selected).toEqual(['button--primary', 'button--loading', 'chat--mine']);
  });

  it('records a screenshot that is not a PNG as an error', async () => {
    const { driver, input } = setup();
    driver.queueScreenshots(Uint8Array.of(1, 2, 3));

    const report = await captureStories({ ...input, options: { ...options, limit: 1 } });

    expect(report.stories[0]?.error).toBe('screenshot is not a PNG');
  });
});

describe('captureStories options', () => {
  it('applies the injected blank check', async () => {
    const { driver, input } = setup();
    driver.queueScreenshots(frameA);

    const report = await captureStories({
      ...input,
      isBlank: (png) => png === frameA,
      options: { ...options, limit: 1 },
    });

    expect(report.stories[0]?.blank).toBe(true);
  });

  it('captures only the stories matching filter, up to limit', async () => {
    const { channel, driver, input } = setup();
    driver.queueScreenshots(frameA);

    await captureStories({ ...input, options: { ...options, filter: 'Button', limit: 1 } });

    expect(channel.selected).toEqual(['button--primary']);
  });
});

describe('captureStories abort', () => {
  it('stops after the story in flight once the signal is aborted, without reporting it', async () => {
    const { channel, progress, input } = setup();
    const controller = new AbortController();
    const sleep = (ms: number): Promise<void> => {
      if (channel.selected.length === 2) controller.abort(new Error('app exited'));
      return input.sleep(ms);
    };

    const report = captureStories({ ...input, sleep, signal: controller.signal });

    await expect(report).rejects.toThrow('app exited');
    expect(channel.selected).toEqual(['button--primary', 'button--loading']);
    expect(progress.map((event) => event.result.id)).toEqual(['button--primary']);
  });
});

describe('selectStories', () => {
  it('matches the filter against id or title and then applies the limit', () => {
    expect(selectStories(index, { filter: 'chat' }).map((story) => story.id)).toEqual([
      'chat--mine',
    ]);
    expect(selectStories(index, { filter: 'UI/' }).map((story) => story.id)).toEqual([
      'button--primary',
      'button--loading',
    ]);
    expect(selectStories(index, { limit: 2 })).toHaveLength(2);
    expect(selectStories(index, {})).toBe(index);
  });
});
