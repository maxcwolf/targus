import { describe, expect, it } from 'vitest';

import type { CaptureManifest, StoryRecord } from '../capture/manifest.ts';
import { compareCaptures } from './compare-captures.ts';

function story(id: string, overrides: Partial<StoryRecord> = {}): StoryRecord {
  return {
    id,
    variant: 'default',
    title: 'T',
    name: id,
    file: `${id}.png`,
    hash: `h-${id}`,
    width: 2,
    height: 2,
    renderMs: 1,
    captureMs: 1,
    attempts: 1,
    stable: true,
    blank: false,
    error: null,
    ...overrides,
  };
}

function manifest(stories: StoryRecord[], skipped: string[] = []): CaptureManifest {
  return {
    version: 1,
    summary: {
      platform: 'ios',
      device: { udid: 'SIM', appearance: 'light', name: null },
      app: { bundleId: 'co.example', path: null },
      storybook: null,
      viewport: null,
      pixelRatio: null,
      settleMs: 300,
      stabilityGapMs: 150,
      storyCount: stories.length,
      captured: stories.length,
      failed: 0,
      unstable: [],
      blank: [],
      skipped,
      duplicateHashes: [],
      startedAt: '2026-11-04T10:00:00.000Z',
      durationMs: 1,
      perStoryMs: null,
    },
    stories,
  };
}

/** PNG bytes are just the file name; the fake diff reads the ratio out of the current name. */
const loadPng = (side: 'current' | 'baseline', file: string): Promise<Uint8Array> =>
  Promise.resolve(new TextEncoder().encode(`${side}:${file}`));

const ratios: Record<string, number> = {
  'current:changed.png': 0.2,
  'current:noise.png': 0.0005,
  'current:spinner.png': 0.01,
};

const diffPng = Uint8Array.of(9);

const baseline = manifest([
  story('same'),
  story('changed'),
  story('noise'),
  story('spinner'),
  story('gone'),
  story('broken'),
  story('was-error', { file: null, hash: null, error: 'x' }),
]);

const current = manifest([
  story('same'),
  story('changed', { hash: 'new' }),
  story('noise', { hash: 'new' }),
  story('spinner', { hash: 'new', stable: false }),
  story('broken', { file: null, hash: null, error: 'No QueryClient set' }),
  story('was-error'),
  story('fresh'),
  story('lost', { file: null, hash: null }),
]);

describe('compareCaptures', () => {
  it('sorts stories into every bucket', async () => {
    const compared: string[] = [];
    const comparison = await compareCaptures({
      baseline,
      current,
      threshold: 0.001,
      loadPng,
      compareImages: (_baseline, current) => {
        const name = new TextDecoder().decode(current);
        compared.push(name);
        return { ratio: ratios[name] ?? 0, diffPng };
      },
    });

    expect(comparison.changed).toEqual([
      {
        id: 'changed',
        ratio: 0.2,
        baselineFile: 'changed.png',
        currentFile: 'changed.png',
        diffPng,
      },
    ]);
    expect(comparison.unchanged.map(({ id, ratio }) => [id, ratio])).toEqual([
      ['same', 0],
      ['noise', 0.0005],
    ]);
    expect(comparison.unstable.map(({ id, ratio }) => [id, ratio])).toEqual([['spinner', 0.01]]);
    expect(comparison.new).toEqual([{ id: 'was-error' }, { id: 'fresh' }]);
    expect(comparison.removed).toEqual([{ id: 'gone' }]);
    expect(comparison.errored).toEqual([
      { id: 'broken', error: 'No QueryClient set' },
      { id: 'lost', error: 'no capture' },
    ]);
    expect(comparison.threshold).toBe(0.001);
    expect(compared).toEqual(['current:changed.png', 'current:noise.png', 'current:spinner.png']);
  });

  it('does not call a story removed when the current capture skipped it', async () => {
    const comparison = await compareCaptures({
      baseline,
      current: manifest(current.stories, ['gone']),
      threshold: 0.001,
      loadPng,
      compareImages: () => ({ ratio: 0, diffPng: null }),
    });

    expect(comparison.removed).toEqual([]);
  });
});

describe('compareCaptures with mode variants', () => {
  it('pairs each mode variant with its own baseline', async () => {
    const comparison = await compareCaptures({
      baseline: manifest([
        story('a', { variant: 'dark', file: 'a@dark.png' }),
        story('a', { variant: 'print', file: 'a@print.png' }),
      ]),
      current: manifest([
        story('a', { variant: 'dark', file: 'a@dark.png', hash: 'new' }),
        story('a', { variant: 'light', file: 'a@light.png' }),
      ]),
      threshold: 0.001,
      loadPng,
      compareImages: () => ({ ratio: 0.5, diffPng: null }),
    });

    expect(comparison.changed.map(({ id, baselineFile }) => [id, baselineFile])).toEqual([
      ['a@dark', 'a@dark.png'],
    ]);
    expect(comparison.new).toEqual([{ id: 'a@light' }]);
    expect(comparison.removed).toEqual([{ id: 'a@print' }]);
  });
});
