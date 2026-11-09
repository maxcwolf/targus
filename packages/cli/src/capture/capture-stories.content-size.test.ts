import {
  createFakeClock,
  createFakeDeviceDriver,
  createFakeStorybookChannel,
  type ContentSize,
  type DeviceDriverCall,
  type StoryIndexEntry,
} from '@targus/core';
import { describe, expect, it } from 'vitest';

import { captureStories } from './capture-stories.ts';
import { encodeSolidPng } from './solid-png.fake.ts';

const index: StoryIndexEntry[] = [
  { id: 'button--primary', title: 'Button', name: 'Primary' },
  { id: 'card--plain', title: 'Card', name: 'Plain' },
];

const frame = encodeSolidPng(4, 8, [255, 255, 255, 255]);
const hash = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

function setup(contentSizes: readonly ContentSize[]) {
  const clock = createFakeClock();
  const channel = createFakeStorybookChannel(index);
  const driver = createFakeDeviceDriver();
  driver.queueScreenshots(frame);
  const slept: number[] = [];
  const input = {
    channel,
    driver,
    options: { settleMs: 300, stabilityGapMs: 150, renderTimeoutMs: 10000, maxAttempts: 3 },
    clock,
    sleep: (ms: number) => {
      slept.push(ms);
      clock.advance(ms);
      return Promise.resolve();
    },
    hash,
    compareImages: () => ({ ratio: 0, diffPng: null }),
  };
  channel.setOutcome('button--primary', {
    kind: 'rendered',
    parameters: { delay: null, skip: false, contentSizes },
  });
  return { channel, driver, input, slept };
}

const sizesSet = (calls: readonly DeviceDriverCall[]): string[] =>
  calls.flatMap((call) => (call.method === 'setContentSize' ? [call.contentSize] : []));

describe('captureStories on a device, with content sizes', () => {
  it('captures the default, then each size as its own variant, and puts the size back', async () => {
    const { channel, driver, input } = setup(['ax5', 's']);

    const report = await captureStories(input);

    expect(report.stories.map((story) => [story.id, story.variant])).toEqual([
      ['button--primary', 'default'],
      ['button--primary', 'ax5'],
      ['button--primary', 's'],
      ['card--plain', 'default'],
    ]);
    expect(report.stories.every((story) => story.png !== null && story.stable)).toBe(true);
    expect(sizesSet(driver.calls)).toEqual(['ax5', 's', 'l']);
    // The story stays on screen: a size is a new layout, not a new selection.
    expect(channel.selected).toEqual(['button--primary', 'card--plain']);
  });

  it('screenshots a size only after it is set, and settles after the reset', async () => {
    const { driver, input, slept } = setup(['ax5']);

    await captureStories({ ...input, stories: index.slice(0, 1) });

    const methods = driver.calls.map((call) => call.method);
    expect(methods).toEqual([
      'screenshot',
      'screenshot',
      'setContentSize',
      'screenshot',
      'screenshot',
      'setContentSize',
    ]);
    expect(slept.at(-1)).toBe(300);
  });
});

describe('captureStories on a device, when a size is not captured', () => {
  it('captures a story without content sizes once', async () => {
    const { driver, input } = setup([]);

    const report = await captureStories(input);

    expect(report.stories.map((story) => story.variant)).toEqual(['default', 'default']);
    expect(sizesSet(driver.calls)).toEqual([]);
  });

  it("records a size the device refuses as that variant's error, and still resets", async () => {
    const { driver, input } = setup(['ax5', 's']);
    const refusing = {
      ...driver,
      setContentSize: (size: ContentSize) =>
        size === 's' ? Promise.reject(new Error('simctl said no')) : driver.setContentSize(size),
    };

    const report = await captureStories({ ...input, driver: refusing, stories: index.slice(0, 1) });

    expect(report.stories.map((story) => [story.variant, story.error])).toEqual([
      ['default', null],
      ['ax5', null],
      ['s', 'simctl said no'],
    ]);
    expect(driver.calls.filter((call) => call.method === 'setContentSize')).toHaveLength(2);
  });

  it('captures no size of a story that failed to render', async () => {
    const { channel, driver, input } = setup(['ax5']);
    channel.setOutcome('button--primary', { kind: 'error', message: 'boom' });

    const report = await captureStories({ ...input, stories: index.slice(0, 1) });

    expect(report.stories.map((story) => [story.variant, story.error])).toEqual([
      ['default', 'boom'],
    ]);
    expect(sizesSet(driver.calls)).toEqual([]);
  });

  it('captures no size with a driver that cannot set it, as on the web', async () => {
    const { driver, input } = setup(['ax5']);

    const report = await captureStories({
      ...input,
      driver: { screenshot: () => driver.screenshot() },
    });

    expect(report.stories.map((story) => story.variant)).toEqual(['default', 'default']);
  });
});
