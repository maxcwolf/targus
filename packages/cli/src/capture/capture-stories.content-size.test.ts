import {
  createFakeClock,
  createFakeDeviceDriver,
  createFakeStorybookChannel,
  type CaptureMode,
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

const largest: CaptureMode = {
  name: 'largest text',
  globals: {},
  viewport: null,
  contentSize: 'accessibility-extra-extra-extra-large',
};
const small: CaptureMode = {
  name: 'small text',
  globals: {},
  viewport: null,
  contentSize: 'small',
};
const dark: CaptureMode = { name: 'dark', globals: { theme: 'dark' }, viewport: null };

function setup(modes: readonly CaptureMode[]) {
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
    parameters: { delay: null, skip: false, modes },
  });
  return { channel, driver, input, slept };
}

const sizesSet = (calls: readonly DeviceDriverCall[]): string[] =>
  calls.flatMap((call) => (call.method === 'setContentSize' ? [call.contentSize] : []));

describe('captureStories on a device, with content size modes', () => {
  it('captures the default, then each sized mode, and puts the size back', async () => {
    const { channel, driver, input } = setup([largest, small]);

    const report = await captureStories(input);

    expect(report.stories.map((story) => [story.id, story.variant])).toEqual([
      ['button--primary', 'default'],
      ['button--primary', 'largest text'],
      ['button--primary', 'small text'],
      ['card--plain', 'default'],
    ]);
    expect(report.stories.every((story) => story.png !== null && story.stable)).toBe(true);
    expect(sizesSet(driver.calls)).toEqual([
      'accessibility-extra-extra-extra-large',
      'small',
      'large',
    ]);
    // The story stays on screen: a sized mode is a new layout, not a new selection.
    expect(channel.selected).toEqual(['button--primary', 'card--plain']);
  });

  it('screenshots a sized mode only after its size is set, and settles after the reset', async () => {
    const { driver, input, slept } = setup([largest]);

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

describe('captureStories on a device, with modes it does not size', () => {
  it('leaves out modes without a content size, and a mode named default', async () => {
    const named: CaptureMode = { ...small, name: 'default' };
    const { driver, input } = setup([dark, named]);

    const report = await captureStories(input);

    expect(report.stories.map((story) => story.variant)).toEqual(['default', 'default']);
    expect(sizesSet(driver.calls)).toEqual([]);
  });

  it("records a size the device refuses as that mode's error, and still resets", async () => {
    const { driver, input } = setup([largest, small]);
    const refusing = {
      ...driver,
      setContentSize: (size: ContentSize) =>
        size === 'small'
          ? Promise.reject(new Error('simctl said no'))
          : driver.setContentSize(size),
    };

    const report = await captureStories({ ...input, driver: refusing, stories: index.slice(0, 1) });

    expect(report.stories.map((story) => [story.variant, story.error])).toEqual([
      ['default', null],
      ['largest text', null],
      ['small text', 'simctl said no'],
    ]);
    expect(driver.calls.filter((call) => call.method === 'setContentSize')).toHaveLength(2);
  });

  it('does not size a story that failed to render', async () => {
    const { channel, driver, input } = setup([largest]);
    channel.setOutcome('button--primary', { kind: 'error', message: 'boom' });

    const report = await captureStories({ ...input, stories: index.slice(0, 1) });

    expect(report.stories.map((story) => [story.variant, story.error])).toEqual([
      ['default', 'boom'],
    ]);
    expect(sizesSet(driver.calls)).toEqual([]);
  });

  it('captures no sized mode with a driver that cannot set the size, as on the web', async () => {
    const { driver, input } = setup([largest]);

    const report = await captureStories({
      ...input,
      driver: { screenshot: () => driver.screenshot() },
    });

    expect(report.stories.map((story) => story.variant)).toEqual(['default', 'default']);
  });
});
