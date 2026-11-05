import { describe, expect, it } from 'vitest';

import type { ReviewState, SnapshotState } from '../contracts/snapshot.js';
import { acceptedImageHash } from './accepted-image-hash.js';

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
    ['unstable', 'approved'],
  ] as const)('accepts the captured image of a %s snapshot that is %s', (state, review) => {
    expect(acceptedImageHash(snapshot(state, review))).toBe(current);
  });

  it.each([
    ['changed', 'pending'],
    ['changed', 'denied'],
    ['unstable', 'pending'],
  ] as const)('keeps the baseline image of a %s snapshot that is %s', (state, review) => {
    expect(acceptedImageHash(snapshot(state, review))).toBe(baseline);
  });

  it('keeps the baseline image of a story whose render errored', () => {
    expect(acceptedImageHash(snapshot('error', 'pending', null))).toBe(baseline);
  });

  it('has no accepted image for an unapproved new story or a removed one', () => {
    expect(acceptedImageHash(snapshot('new', 'pending'))).toBeNull();
    expect(acceptedImageHash(snapshot('removed', 'approved', null))).toBeNull();
  });
});
