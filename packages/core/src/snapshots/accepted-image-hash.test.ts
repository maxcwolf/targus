import { describe, expect, it } from 'vitest';

import type { ReviewState, SnapshotState } from '../contracts/snapshot.ts';
import { acceptedImageHash } from './accepted-image-hash.ts';

const current = 'b'.repeat(64);
const baseline = 'a'.repeat(64);

function snapshot(state: SnapshotState, review: ReviewState, imageHash: string | null = current) {
  return { imageHash, baselineHash: state === 'new' ? null : baseline, state, review };
}

describe('acceptedImageHash', () => {
  it.each([
    ['unchanged', 'pending'],
    ['unchanged', 'approved'],
    ['changed', 'approved'],
    ['new', 'approved'],
  ] as const)('accepts the captured image of a %s snapshot that is %s', (state, review) => {
    expect(acceptedImageHash(snapshot(state, review))).toBe(current);
  });

  it.each([
    ['changed', 'pending'],
    ['changed', 'denied'],
    ['unstable', 'approved'],
    ['unstable', 'pending'],
  ] as const)('keeps the baseline image of a %s snapshot that is %s', (state, review) => {
    expect(acceptedImageHash(snapshot(state, review))).toBe(baseline);
  });

  it('never adopts an unstable capture, though it is approved so that it never blocks', () => {
    // compareSnapshot stores every unstable story as approved (ADR 0030).
    const unstable = snapshot('unstable', 'approved');

    expect(acceptedImageHash(unstable)).toBe(unstable.baselineHash);
    expect(acceptedImageHash(unstable)).not.toBe(unstable.imageHash);
  });

  it('keeps the baseline image of a story whose render errored', () => {
    expect(acceptedImageHash(snapshot('error', 'pending', null))).toBe(baseline);
  });

  it('has no accepted image for an unapproved new story or a removed one', () => {
    expect(acceptedImageHash(snapshot('new', 'pending'))).toBeNull();
    expect(acceptedImageHash(snapshot('removed', 'approved', null))).toBeNull();
  });
});
