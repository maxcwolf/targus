import { describe, expect, it } from 'vitest';

import {
  Approval,
  Build,
  CreateBuildRequest,
  CreateBuildResponse,
  HealthResponse,
  ReviewRequest,
  Snapshot,
  SubmitResultsRequest,
} from './index.js';

const sha = 'a'.repeat(40);
const hash = 'b'.repeat(64);

describe('CreateBuildRequest', () => {
  it('defaults a snapshot variant to "default"', () => {
    const request = CreateBuildRequest.parse({
      sha,
      branch: 'feature/button',
      prNumber: 12,
      mergeBaseSha: sha,
      ancestors: [sha],
      trigger: 'pr',
      device: 'iPhone 16',
      snapshots: [{ storyId: 'button--primary', imageHash: hash, width: 1179, height: 2556 }],
    });

    expect(request.snapshots[0]?.variant).toBe('default');
  });

  it('rejects an image hash that is not a sha256 digest', () => {
    const result = CreateBuildRequest.safeParse({
      sha,
      branch: 'main',
      prNumber: null,
      mergeBaseSha: null,
      ancestors: [],
      trigger: 'main',
      device: 'iPhone 16',
      snapshots: [{ storyId: 'button--primary', imageHash: 'nope', width: 1, height: 1 }],
    });

    expect(result.success).toBe(false);
  });
});

describe('CreateBuildResponse', () => {
  it('accepts a build with no baseline', () => {
    const response = CreateBuildResponse.parse({
      build: { id: 'build-1', number: 1 },
      baselineBuildId: null,
      baselines: [],
      missingImageHashes: [hash],
    });

    expect(response.missingImageHashes).toEqual([hash]);
  });
});

describe('Build and Snapshot', () => {
  it('parse stored rows', () => {
    const build = Build.parse({
      id: 'build-1',
      projectId: 'project-1',
      number: 1,
      sha,
      branch: 'main',
      prNumber: null,
      mergeBaseSha: null,
      baselineBuildId: null,
      trigger: 'main',
      device: 'iPhone 16',
      status: 'pending',
      createdAt: '2026-11-04T10:00:00.000Z',
      completedAt: null,
    });
    const snapshot = Snapshot.parse({
      id: 'snapshot-1',
      buildId: build.id,
      storyId: 'button--primary',
      variant: 'default',
      imageHash: hash,
      width: 1179,
      height: 2556,
      baselineHash: null,
      diffHash: null,
      diffRatio: null,
      state: 'new',
      review: 'pending',
      reviewedBy: null,
      reviewedAt: null,
    });

    expect(snapshot.buildId).toBe(build.id);
  });

  it('rejects an unknown snapshot state', () => {
    expect(Snapshot.shape.state.safeParse('flaky').success).toBe(false);
  });
});

describe('HealthResponse', () => {
  it('requires a version', () => {
    expect(HealthResponse.safeParse({ ok: true }).success).toBe(false);
    expect(HealthResponse.parse({ ok: true, version: '0.0.0' }).ok).toBe(true);
  });
});

describe('Approval', () => {
  const approval = {
    projectId: 'project-1',
    storyId: 'button--primary',
    variant: 'default',
    fromHash: hash,
    toHash: 'c'.repeat(64),
    approvedBy: 'octocat',
    approvedAt: '2026-11-04T10:00:00.000Z',
  };

  it('parses a changed-story approval and a new-story approval with no fromHash', () => {
    expect(Approval.parse(approval).fromHash).toBe(hash);
    expect(Approval.parse({ ...approval, fromHash: null }).fromHash).toBeNull();
  });

  it('requires a target hash', () => {
    expect(Approval.safeParse({ ...approval, toHash: null }).success).toBe(false);
  });
});

const result = {
  storyId: 'button--primary',
  state: 'changed',
  imageHash: hash,
  width: 1179,
  height: 2556,
  diffHash: 'c'.repeat(64),
  diffRatio: 0.02,
  error: null,
  blank: false,
};

describe('SubmitResultsRequest', () => {
  it('defaults the variant and accepts an errored story without an image', () => {
    const request = SubmitResultsRequest.parse({
      results: [
        result,
        {
          ...result,
          storyId: 'button--broken',
          imageHash: null,
          width: null,
          height: null,
          diffHash: null,
          diffRatio: null,
          state: 'error',
          error: 'render timed out',
        },
      ],
      durationMs: 42_000,
    });

    expect(request.results.map((r) => r.variant)).toEqual(['default', 'default']);
  });

  it('rejects a diff ratio above 1 and a negative duration', () => {
    expect(
      SubmitResultsRequest.safeParse({ results: [{ ...result, diffRatio: 1.5 }], durationMs: 1 })
        .success,
    ).toBe(false);
    expect(SubmitResultsRequest.safeParse({ results: [], durationMs: -1 }).success).toBe(false);
  });
});

describe('StoryResult error invariants', () => {
  function issues(story: Record<string, unknown>) {
    const parsed = SubmitResultsRequest.safeParse({ results: [story], durationMs: 1 });
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
  }

  it('requires an error result to carry a message and no image', () => {
    expect(issues({ ...result, state: 'error', error: null })).toEqual([
      'an error result needs a non-empty error message',
      'an error result has no image, so imageHash must be null',
    ]);
    expect(issues({ ...result, state: 'error', imageHash: null, error: '' })).not.toEqual([]);
    expect(issues({ ...result, state: 'error', imageHash: null, error: 'boom' })).toEqual([]);
  });

  it('requires a non-error result to have error null', () => {
    expect(issues({ ...result, error: 'render timed out' })).toEqual([
      'a changed result must have error null; use state "error"',
    ]);
  });
});

describe('ReviewRequest', () => {
  it('accepts only approve or deny', () => {
    expect(ReviewRequest.parse({ decision: 'approve' }).decision).toBe('approve');
    expect(ReviewRequest.parse({ decision: 'deny' }).decision).toBe('deny');
    expect(ReviewRequest.safeParse({ decision: 'maybe' }).success).toBe(false);
  });
});
