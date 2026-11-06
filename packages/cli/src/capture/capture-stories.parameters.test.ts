import {
  createFakeClock,
  createFakeDeviceDriver,
  createFakeStorybookChannel,
  type StoryCaptureParameters,
  type StoryIndexEntry,
} from '@targus/core';
import { describe, expect, it } from 'vitest';

import { captureStories, type CaptureProgress } from './capture-stories.ts';
import { encodeSolidPng } from './solid-png.fake.ts';

const index: StoryIndexEntry[] = [
  { id: 'spinner--loading', title: 'Spinner', name: 'Loading' },
  { id: 'toast--enter', title: 'Toast', name: 'Enter' },
  { id: 'button--primary', title: 'Button', name: 'Primary' },
];

const frameA = encodeSolidPng(4, 8, [255, 255, 255, 255]);
const frameB = encodeSolidPng(4, 8, [0, 0, 0, 255]);
const hash = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

function setup() {
  const clock = createFakeClock();
  const channel = createFakeStorybookChannel(index);
  const driver = createFakeDeviceDriver();
  const sleeps: number[] = [];
  const progress: CaptureProgress[] = [];
  const input = {
    channel,
    driver,
    options: { settleMs: 300, stabilityGapMs: 150, renderTimeoutMs: 10000, maxAttempts: 3 },
    clock,
    sleep: (ms: number) => {
      sleeps.push(ms);
      clock.advance(ms);
      return Promise.resolve();
    },
    hash,
    compareImages: () => ({ ratio: 0.5, diffPng: null }),
    onProgress: (event: CaptureProgress) => progress.push(event),
  };
  const set = (storyId: string, parameters: StoryCaptureParameters) => {
    channel.setOutcome(storyId, { kind: 'rendered', parameters });
  };
  return { channel, driver, sleeps, progress, input, set };
}

describe('captureStories with parameters.targus.skip', () => {
  it('leaves a skipped story out of the results, not as an error, and moves on', async () => {
    const { channel, driver, progress, input, set } = setup();
    set('spinner--loading', { delay: null, skip: true });
    driver.queueScreenshots(frameA);

    const report = await captureStories(input);

    expect(report.skipped).toEqual(['spinner--loading']);
    expect(report.stories.map((story) => story.id)).toEqual(['toast--enter', 'button--primary']);
    expect(report.stories.every((story) => story.error === null)).toBe(true);
    expect(channel.selected).toEqual(['spinner--loading', 'toast--enter', 'button--primary']);
    // Two screenshots for each captured story, none for the skipped one.
    expect(driver.calls).toHaveLength(4);
    expect(progress[0]).toMatchObject({
      index: 0,
      total: 3,
      skipped: true,
      result: { id: 'spinner--loading', png: null, error: null },
    });
  });

  it('skips without waiting even when the story also sets a delay', async () => {
    const { driver, sleeps, input, set } = setup();
    set('spinner--loading', { delay: 5000, skip: true });

    const report = await captureStories({ ...input, options: { ...input.options, limit: 1 } });

    expect(report.skipped).toEqual(['spinner--loading']);
    expect(report.stories).toEqual([]);
    expect(sleeps).toEqual([]);
    expect(driver.calls).toEqual([]);
  });
});

describe('captureStories with parameters.targus.delay', () => {
  it('waits the story delay instead of settleMs before the first screenshot', async () => {
    const { driver, sleeps, input, set } = setup();
    set('toast--enter', { delay: 1200, skip: false });
    driver.queueScreenshots(frameA);

    const report = await captureStories({ ...input, stories: index.slice(1, 2) });

    expect(sleeps).toEqual([1200, 150]);
    expect(report.stories[0]).toMatchObject({ stable: true, captureMs: 1350 });
  });

  it('doubles the story delay on a stability retry, and honours a delay of 0', async () => {
    const { driver, sleeps, input, set } = setup();
    set('toast--enter', { delay: 400, skip: false });
    set('button--primary', { delay: 0, skip: false });
    driver.queueScreenshots(frameA, frameB, frameB, frameB, frameA, frameA);

    await captureStories({ ...input, stories: index.slice(1) });

    expect(sleeps).toEqual([400, 150, 800, 150, 0, 150]);
  });

  it('uses settleMs when the app reports no delay or no parameters at all', async () => {
    const { driver, sleeps, input, set } = setup();
    set('toast--enter', { delay: null, skip: false });
    driver.queueScreenshots(frameA);

    await captureStories({ ...input, stories: index.slice(1) });

    expect(sleeps).toEqual([300, 150, 300, 150]);
  });
});

describe('captureStories with an invalid parameters.targus', () => {
  it('records the story as an error naming the bad field, without a screenshot', async () => {
    const { channel, driver, input } = setup();
    channel.setOutcome('toast--enter', {
      kind: 'error',
      message: 'invalid parameters.targus: delay: Too big: expected number to be <=10000',
    });

    const report = await captureStories({ ...input, stories: index.slice(1, 2) });

    expect(report.stories[0]?.error).toMatch(/^invalid parameters\.targus: delay/);
    expect(report.skipped).toEqual([]);
    expect(driver.calls).toEqual([]);
  });
});

describe('captureStories abort with parameters.targus.skip', () => {
  it('neither records nor reports a skipped story in flight when the run is aborted', async () => {
    const { channel, progress, input, set } = setup();
    set('spinner--loading', { delay: null, skip: true });
    const controller = new AbortController();
    const select = channel.selectStory.bind(channel);
    channel.selectStory = async (storyId, timeoutMs) => {
      const selection = await select(storyId, timeoutMs);
      controller.abort(new Error('app exited'));
      return selection;
    };

    await expect(captureStories({ ...input, signal: controller.signal })).rejects.toThrow(
      'app exited',
    );
    expect(channel.selected).toEqual(['spinner--loading']);
    expect(progress).toEqual([]);
  });
});
