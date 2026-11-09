import {
  createFakeClock,
  createFakeDeviceDriver,
  createFakeStorybookChannel,
  type CaptureMode,
  type StoryIndexEntry,
} from '@targus/core';
import { describe, expect, it } from 'vitest';

import { captureStories } from './capture-stories.ts';
import { encodeSolidPng } from './solid-png.fake.ts';
import { fileStem, variantLabel } from './variant.ts';

const index: StoryIndexEntry[] = [
  { id: 'button--primary', title: 'Button', name: 'Primary' },
  { id: 'card--plain', title: 'Card', name: 'Plain' },
];

const frame = encodeSolidPng(4, 8, [255, 255, 255, 255]);
const hash = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

const light: CaptureMode = { name: 'light', globals: { theme: 'light' }, viewport: null };
const dark: CaptureMode = { name: 'dark mode', globals: { theme: 'dark' }, viewport: null };

function setup(supportsModes: boolean) {
  const clock = createFakeClock();
  const channel = createFakeStorybookChannel(index, { supportsModes });
  const driver = createFakeDeviceDriver();
  driver.queueScreenshots(frame);
  const input = {
    channel,
    driver,
    options: { settleMs: 300, stabilityGapMs: 150, renderTimeoutMs: 10000, maxAttempts: 3 },
    clock,
    sleep: (ms: number) => {
      clock.advance(ms);
      return Promise.resolve();
    },
    hash,
    compareImages: () => ({ ratio: 0, diffPng: null }),
  };
  channel.setOutcome('button--primary', {
    kind: 'rendered',
    parameters: { delay: null, skip: false, modes: [light, dark] },
  });
  return { channel, input };
}

describe('captureStories with modes', () => {
  it('captures a story once per mode, each as its own variant', async () => {
    const { channel, input } = setup(true);

    const report = await captureStories(input);

    expect(report.stories.map((story) => [story.id, story.variant])).toEqual([
      ['button--primary', 'light'],
      ['button--primary', 'dark mode'],
      ['card--plain', 'default'],
    ]);
    expect(report.stories.every((story) => story.png !== null)).toBe(true);
    expect(channel.selectedModes).toEqual([null, 'light', 'dark mode', null]);
  });

  it('captures the default globals once on a channel without mode support', async () => {
    const { channel, input } = setup(false);

    const report = await captureStories(input);

    expect(report.stories.map((story) => story.variant)).toEqual(['default', 'default']);
    expect(channel.selectedModes).toEqual([null, null]);
  });
});

describe('captureStories with device-only modes', () => {
  it("leaves out a mode that only sets a content size, which is a device's", async () => {
    const { channel, input } = setup(true);
    const sized: CaptureMode = {
      name: 'large text',
      globals: {},
      viewport: null,
      contentSize: 'extra-large',
    };
    channel.setOutcome('button--primary', {
      kind: 'rendered',
      parameters: { delay: null, skip: false, modes: [sized, dark] },
    });
    channel.setOutcome('card--plain', {
      kind: 'rendered',
      parameters: { delay: null, skip: false, modes: [sized] },
    });

    const report = await captureStories({
      ...input,
      driver: { screenshot: () => input.driver.screenshot() },
    });

    expect(report.stories.map((story) => [story.id, story.variant])).toEqual([
      ['button--primary', 'dark mode'],
      ['card--plain', 'default'],
    ]);
  });
});

describe('captureStories with disabled modes', () => {
  it('skips a story whose modes are all disabled', async () => {
    const { channel, input } = setup(true);
    channel.setOutcome('button--primary', {
      kind: 'rendered',
      parameters: { delay: null, skip: false, modes: [] },
    });

    const report = await captureStories(input);

    expect(report.skipped).toEqual(['button--primary']);
    expect(report.stories.map((story) => story.id)).toEqual(['card--plain']);
  });

  it('records a mode that fails to render as an error of that variant', async () => {
    const { channel, input } = setup(true);
    const selectStory = channel.selectStory.bind(channel);
    channel.selectStory = (id, timeout, mode) =>
      mode?.name === 'dark mode'
        ? Promise.resolve({ kind: 'error', message: 'no dark theme' })
        : selectStory(id, timeout, mode);

    const report = await captureStories(input);

    expect(report.stories[1]).toMatchObject({
      variant: 'dark mode',
      png: null,
      error: 'no dark theme',
    });
  });
});

describe('variantLabel and fileStem', () => {
  it('names a mode variant id@mode and keeps file names safe', () => {
    expect(variantLabel('a--b', 'default')).toBe('a--b');
    expect(variantLabel('a--b', 'dark/rtl')).toBe('a--b@dark/rtl');
    expect(fileStem('a--b@dark/rtl mode')).toBe('a--b@dark%2Frtl%20mode');
  });
});
