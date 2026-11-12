import { describe, expect, it } from 'vitest';

import type { Snapshot } from '@targus/core/browser';

import { hash, initialSnapshots } from '../../test/fixtures.ts';
import { canvasOf, layerBox, sizeChange, splitClip, stageSizes } from './stage-sizes.ts';

const url = (digit: string): string => `/api/images/${hash(digit)}`;

function snapshot(fields: Partial<Snapshot>): Snapshot {
  const [template] = initialSnapshots();
  if (template === undefined) throw new Error('the fixtures have no snapshot');
  return { ...template, ...fields };
}

describe('canvasOf', () => {
  it('is the widest width and the tallest height, which may come from different images', () => {
    expect(canvasOf([{ width: 600, height: 400 }, undefined, { width: 840, height: 290 }])).toEqual(
      { width: 840, height: 400 },
    );
  });

  it('is null while no size is known', () => {
    expect(canvasOf([undefined, undefined])).toBeNull();
  });
});

describe('stageSizes', () => {
  const changed = snapshot({
    imageHash: hash('2'),
    baselineHash: hash('3'),
    diffHash: hash('4'),
    width: 780,
    height: 434,
  });

  it('uses the recorded size of the new capture until images load', () => {
    expect(stageSizes(changed, new Map())).toEqual({
      baseline: undefined,
      current: { width: 780, height: 434 },
      diff: undefined,
      canvas: { width: 780, height: 434 },
    });
  });

  it('prefers the sizes the browser decoded, and ignores a load that gave none', () => {
    const loaded = new Map([
      [url('2'), { width: 390, height: 217 }],
      [url('3'), { width: 420, height: 145 }],
      [url('4'), null],
    ]);
    expect(stageSizes(changed, loaded)).toEqual({
      baseline: { width: 420, height: 145 },
      current: { width: 390, height: 217 },
      diff: undefined,
      canvas: { width: 420, height: 217 },
    });
  });

  it('knows nothing of a snapshot with no image and no recorded size', () => {
    const removed = snapshot({
      imageHash: null,
      baselineHash: hash('8'),
      width: null,
      height: null,
    });
    expect(stageSizes(removed, new Map()).canvas).toBeNull();
    const unsized = snapshot({ imageHash: hash('1'), width: null, height: null });
    expect(stageSizes(unsized, new Map()).current).toBeUndefined();
  });
});

describe('layerBox', () => {
  it('gives an image its share of the canvas', () => {
    expect(layerBox({ width: 600, height: 290 }, { width: 840, height: 290 })).toEqual({
      width: '71.43%',
      height: '100%',
    });
  });

  it('fills the canvas while a size is unknown', () => {
    expect(layerBox(undefined, { width: 10, height: 10 })).toEqual({
      width: '100%',
      height: '100%',
    });
    expect(layerBox({ width: 10, height: 10 }, null)).toEqual({ width: '100%', height: '100%' });
  });
});

describe('splitClip', () => {
  const canvas = { width: 800, height: 100 };

  it('cuts same-size images at the split, one on each side', () => {
    expect(splitClip('baseline', 30, canvas, canvas)).toBe('inset(0 70% 0 0)');
    expect(splitClip('current', 30, canvas, canvas)).toBe('inset(0 0 0 30%)');
    expect(splitClip('baseline', 30, undefined, null)).toBe('inset(0 70% 0 0)');
  });

  it('cuts a narrower image where the split crosses it, and not at all once past it', () => {
    const narrow = { width: 400, height: 100 };
    expect(splitClip('baseline', 25, narrow, canvas)).toBe('inset(0 50% 0 0)');
    expect(splitClip('baseline', 75, narrow, canvas)).toBe('inset(0 0% 0 0)');
    expect(splitClip('current', 75, narrow, canvas)).toBe('inset(0 0 0 100%)');
  });
});

describe('sizeChange', () => {
  it('names both sizes when they differ', () => {
    expect(sizeChange({ width: 780, height: 290 }, { width: 780, height: 434 })).toBe(
      '780 × 290 → 780 × 434 px',
    );
  });

  it('is null for equal sizes or a missing side', () => {
    expect(sizeChange({ width: 1, height: 2 }, { width: 1, height: 2 })).toBeNull();
    expect(sizeChange(undefined, { width: 1, height: 2 })).toBeNull();
    expect(sizeChange({ width: 1, height: 2 }, undefined)).toBeNull();
  });
});
