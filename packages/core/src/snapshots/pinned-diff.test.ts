import { describe, expect, it } from 'vitest';

import { compareSnapshot, defaultThreshold } from './compare-snapshot.ts';
import { pinnedDiff } from './pinned-diff.ts';

const older = 'a'.repeat(64);
const denied = 'b'.repeat(64);
const capture = 'c'.repeat(64);
const diff = 'd'.repeat(64);

function result(baselineHash: string | null, diffRatio: number | null, diffHash: string | null) {
  return { imageHash: capture, baselineHash, diffRatio, diffHash };
}

/** Classify the way the results service does: the pinned diff, against the server's baseline. */
function classify(cli: ReturnType<typeof result>, baselineHash: string | null) {
  const pinned = pinnedDiff(cli, baselineHash);
  const outcome = compareSnapshot({
    current: { imageHash: cli.imageHash, unstable: false, error: null },
    baseline: baselineHash === null ? null : { imageHash: baselineHash },
    diffRatio: pinned.diffRatio,
    threshold: defaultThreshold,
    approvals: [],
  });
  return { ...pinned, ...outcome };
}

describe('pinnedDiff', () => {
  it('keeps the diff measured against the baseline the server compares with', () => {
    expect(pinnedDiff(result(older, 0.02, diff), older)).toEqual({
      diffRatio: 0.02,
      diffHash: diff,
      baselineMoved: false,
    });
    expect(pinnedDiff(result(null, null, null), null)).toEqual({
      diffRatio: null,
      diffHash: null,
      baselineMoved: false,
    });
  });

  it('drops a diff measured against another baseline', () => {
    expect(pinnedDiff(result(denied, 0.02, diff), older)).toEqual({
      diffRatio: null,
      diffHash: null,
      baselineMoved: true,
    });
  });

  it('drops the diff when a baseline appeared or disappeared during the run', () => {
    expect(pinnedDiff(result(null, null, null), older).baselineMoved).toBe(true);
    expect(pinnedDiff(result(older, 0.5, diff), null)).toEqual({
      diffRatio: null,
      diffHash: null,
      baselineMoved: true,
    });
  });

  it('measures 0 when the capture is the new baseline itself', () => {
    expect(pinnedDiff(result(denied, 0.3, diff), capture)).toEqual({
      diffRatio: 0,
      diffHash: null,
      baselineMoved: true,
    });
  });
});

describe('pinnedDiff with compareSnapshot: the baseline is denied while the run is open', () => {
  it('stores a capture of the denied image as changed, not unchanged', () => {
    // The CLI was offered `denied`, saw the same hash and measured 0. A reviewer then denied it
    // on the baseline build, so the server compares with the image before it.
    const cli = { imageHash: denied, baselineHash: denied, diffRatio: 0, diffHash: null };

    expect(classify(cli, older)).toEqual({
      diffRatio: null,
      diffHash: null,
      baselineMoved: true,
      state: 'changed',
      review: 'pending',
    });
  });

  it('never classifies an under-threshold ratio of another image as unchanged', () => {
    expect(classify(result(denied, defaultThreshold / 2, diff), older)).toMatchObject({
      state: 'changed',
      diffRatio: null,
      diffHash: null,
    });
    expect(classify(result(older, defaultThreshold / 2, diff), older)).toMatchObject({
      state: 'unchanged',
      diffRatio: defaultThreshold / 2,
      diffHash: diff,
    });
  });

  it('makes a story whose baseline disappeared new, without a diff', () => {
    expect(classify(result(older, 0.02, diff), null)).toMatchObject({
      state: 'new',
      diffRatio: null,
      diffHash: null,
    });
  });
});
