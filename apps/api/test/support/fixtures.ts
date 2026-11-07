import {
  fakeClockEpoch,
  type CreateBuildRequest,
  type NewBuild,
  type Snapshot,
  type StoryResult,
} from '@targus/core';

import type { SnapshotRecord } from '../../src/repositories/build.repository.ts';
import type { NewProject } from '../../src/repositories/project.repository.ts';

/** A full 40-character sha made of one repeated hex digit. */
export const sha = (digit: string): string => digit.repeat(40);

/** A sha256 hex digest made of one repeated hex digit. */
export const imageHash = (digit: string): string => digit.repeat(64);

export function newProject(key: string, overrides: Partial<NewProject> = {}): NewProject {
  return {
    id: `project-${key}`,
    newOrgId: `org-${key}`,
    githubOrg: `org-${key}`,
    installationId: null,
    repo: `org-${key}/app`,
    name: `App ${key}`,
    defaultBranch: 'main',
    tokenHash: `token-hash-${key}`,
    createdAt: new Date(fakeClockEpoch),
    ...overrides,
  };
}

export function newBuild(
  id: string,
  projectId: string,
  overrides: Partial<NewBuild> = {},
): NewBuild {
  return {
    id,
    projectId,
    sha: sha('a'),
    branch: 'main',
    prNumber: null,
    mergeBaseSha: null,
    baselineBuildId: null,
    trigger: 'main',
    device: 'iPhone 17',
    status: 'in_progress',
    createdAt: fakeClockEpoch,
    completedAt: null,
    checkRunId: null,
    ...overrides,
  };
}

export function snapshotRecord(
  id: string,
  buildId: string,
  overrides: Partial<SnapshotRecord> = {},
): SnapshotRecord {
  const snapshot: Snapshot = {
    id,
    buildId,
    storyId: `story-${id}`,
    variant: 'default',
    title: 'Stories/Example',
    name: `Story ${id}`,
    imageHash: imageHash('1'),
    width: 1179,
    height: 2556,
    baselineHash: null,
    diffHash: null,
    diffRatio: null,
    state: 'new',
    review: 'pending',
    reviewedBy: null,
    reviewedAt: null,
  };
  return { ...snapshot, blank: false, error: null, ...overrides };
}

/** A CLI result for one story, `new` with an image unless overridden. */
export function storyResult(storyId: string, overrides: Partial<StoryResult> = {}): StoryResult {
  return {
    storyId,
    variant: 'default',
    title: null,
    name: null,
    state: 'new',
    imageHash: imageHash('1'),
    width: 1179,
    height: 2556,
    baselineHash: null,
    diffHash: null,
    diffRatio: null,
    error: null,
    blank: false,
    ...overrides,
  };
}

/** A captured story as `POST /api/builds` reports it. */
export function captured(storyId: string, hash: string): CreateBuildRequest['snapshots'][number] {
  return { storyId, variant: 'default', imageHash: hash, width: 1179, height: 2556 };
}

/** A `POST /api/builds` body for a main build on `onSha` with no merge base. */
export function createBuildRequest(
  onSha: string,
  overrides: Partial<CreateBuildRequest> = {},
): CreateBuildRequest {
  return {
    sha: onSha,
    branch: 'main',
    prNumber: null,
    mergeBaseSha: null,
    ancestors: [],
    trigger: 'main',
    device: 'iPhone 17',
    snapshots: [],
    ...overrides,
  };
}
