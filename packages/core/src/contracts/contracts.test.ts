import { describe, expect, it } from 'vitest';

import {
  Approval,
  baselineBuildStatuses,
  Build,
  BuildStatus,
  BuildStatusSummary,
  CreateBuildRequest,
  CreateProjectRequest,
  CreateProjectResponse,
  CreateBuildResponse,
  HealthResponse,
  ReviewRequest,
  Snapshot,
  SubmitResultsRequest,
  SubmitResultsResponse,
  UploadImageResponse,
} from './index.ts';

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
      checkRunId: null,
    });
    const snapshot = Snapshot.parse({
      id: 'snapshot-1',
      buildId: build.id,
      storyId: 'button--primary',
      variant: 'default',
      title: 'Button',
      name: 'Primary',
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
});

describe('Build checkRunId', () => {
  it('requires a check run id that is a positive integer or null', () => {
    const build = {
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
    };
    expect(Build.parse({ ...build, checkRunId: 901 }).checkRunId).toBe(901);
    expect(Build.safeParse(build).success).toBe(false);
    expect(Build.safeParse({ ...build, checkRunId: 0 }).success).toBe(false);
  });
});

describe('SnapshotState', () => {
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

describe('CreateProjectRequest', () => {
  it('defaults the default branch to main and validates the repo name', () => {
    const request = CreateProjectRequest.parse({
      githubOrg: 'example-org',
      installationId: null,
      repo: 'example-org/example-app',
      name: 'the pilot app',
    });

    expect(request.defaultBranch).toBe('main');
    expect(CreateProjectRequest.safeParse({ ...request, repo: 'the pilot app' }).success).toBe(false);
  });

  it('requires the returned token to be at least 32 characters', () => {
    const project = {
      id: 'p1',
      orgId: 'o1',
      repo: 'example-org/example-app',
      name: 'the pilot app',
      defaultBranch: 'main',
    };

    expect(CreateProjectResponse.safeParse({ project, token: 'short' }).success).toBe(false);
    expect(CreateProjectResponse.safeParse({ project, token: 't'.repeat(32) }).success).toBe(true);
  });
});

describe('SubmitResultsResponse', () => {
  it('accepts a null check run and requires a review url', () => {
    const summary = {
      status: 'pending',
      conclusion: null,
      pendingCount: 2,
      deniedCount: 0,
      errorCount: 0,
    };
    const response = { build: { id: 'b1', number: 3 }, summary, reviewUrl: 'https://x.test/b1' };

    expect(SubmitResultsResponse.safeParse({ ...response, checkRun: null }).success).toBe(true);
    expect(SubmitResultsResponse.safeParse({ ...response, checkRun: { id: 9 } }).success).toBe(
      true,
    );
    expect(SubmitResultsResponse.safeParse({ ...response, reviewUrl: 'nope' }).success).toBe(false);
  });

  it('says why there is no check run, defaulting to null for an older server', () => {
    const summary = { status: 'passed', conclusion: 'success', pendingCount: 0 };
    const response = { build: { id: 'b1', number: 3 }, reviewUrl: 'https://x.test/b1' };
    const body = { ...response, summary: { ...summary, deniedCount: 0, errorCount: 0 } };
    const parse = (extra: object) => SubmitResultsResponse.safeParse({ ...body, ...extra });

    expect(parse({ checkRun: null }).data?.checkRunMissing).toBeNull();
    expect(parse({ checkRun: null, checkRunMissing: 'failed' }).data?.checkRunMissing).toBe(
      'failed',
    );
    expect(parse({ checkRun: null, checkRunMissing: 'gone' }).success).toBe(false);
  });
});

describe('BuildStatusSummary', () => {
  it('accepts an in_progress build with no conclusion', () => {
    const summary = {
      status: 'in_progress',
      conclusion: null,
      pendingCount: 0,
      deniedCount: 0,
      errorCount: 0,
    };
    expect(BuildStatusSummary.parse(summary).status).toBe('in_progress');
    expect(BuildStatusSummary.safeParse({ ...summary, status: 'queued' }).success).toBe(false);
  });
});

describe('baselineBuildStatuses', () => {
  it('lists the signed-off build statuses, each a valid BuildStatus', () => {
    expect(baselineBuildStatuses).toEqual(['passed', 'accepted']);
    for (const status of baselineBuildStatuses) {
      expect(BuildStatus.parse(status)).toBe(status);
    }
  });
});

describe('UploadImageResponse', () => {
  it('requires a sha256 hash', () => {
    expect(UploadImageResponse.safeParse({ hash, stored: true }).success).toBe(true);
    expect(UploadImageResponse.safeParse({ hash: 'abc', stored: true }).success).toBe(false);
  });
});
