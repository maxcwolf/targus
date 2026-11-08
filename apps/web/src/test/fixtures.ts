import type {
  Build,
  GetLibraryResponse,
  ProjectSummary,
  ReviewerUser,
  Snapshot,
} from '@targus/core/browser';

/** A valid sha256 hex digest made of one repeated hex digit, so tests can tell images apart. */
export function hash(digit: string): string {
  return digit.repeat(64);
}

export const reviewer: ReviewerUser = {
  id: 'user-1',
  githubId: 1,
  login: 'octocat',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
};

export const project: ProjectSummary = {
  id: 'project-1',
  orgId: 'org-1',
  githubOrg: 'acme',
  repo: 'acme/mobile',
  name: 'Mobile app',
  defaultBranch: 'main',
};

const buildBase = {
  projectId: project.id,
  mergeBaseSha: null,
  baselineBuildId: null,
  device: 'iPhone 16 / iOS 18.2',
  appearance: 'light',
  platform: 'ios',
  pixelRatio: 3,
  completedAt: '2026-11-01T10:05:00Z',
  checkRunId: null,
} as const;

/** Build #12: a PR build with changes to review (pending). */
export const prBuild: Build = {
  ...buildBase,
  id: 'build-12',
  number: 12,
  sha: 'abcdef1234567890abcdef1234567890abcdef12',
  branch: 'feature/buttons',
  prNumber: 34,
  baselineBuildId: 'build-11',
  trigger: 'pr',
  status: 'pending',
  createdAt: '2026-11-02T09:30:00Z',
};

/** Build #11: a main build where one story errored (failed) and one was unstable. */
export const mainBuild: Build = {
  ...buildBase,
  id: 'build-11',
  number: 11,
  sha: '1234567890abcdef1234567890abcdef12345678',
  branch: 'main',
  prNumber: null,
  trigger: 'main',
  status: 'failed',
  createdAt: '2026-11-01T10:00:00Z',
};

function snapshot(
  fields: Partial<Snapshot> & Pick<Snapshot, 'id' | 'storyId' | 'state'>,
): Snapshot {
  return {
    buildId: prBuild.id,
    variant: 'default',
    title: null,
    name: null,
    imageHash: null,
    width: 1170,
    height: 2532,
    baselineHash: null,
    diffHash: null,
    diffRatio: null,
    review: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    ...fields,
  };
}

/** Every state once, sorted by storyId as the API returns them. */
const snapshots: readonly Snapshot[] = [
  snapshot({
    id: 'snap-new',
    storyId: 'avatar--large',
    title: 'Avatar',
    name: 'Large',
    state: 'new',
    imageHash: hash('1'),
  }),
  snapshot({
    id: 'snap-changed',
    storyId: 'button--primary',
    title: 'Button',
    name: 'Primary',
    state: 'changed',
    imageHash: hash('2'),
    baselineHash: hash('3'),
    diffHash: hash('4'),
    diffRatio: 0.0123,
  }),
  snapshot({
    id: 'snap-approved',
    storyId: 'card--default',
    title: 'Card',
    name: 'Default',
    state: 'changed',
    imageHash: hash('5'),
    baselineHash: hash('6'),
    diffHash: hash('7'),
    diffRatio: 0.2,
    review: 'approved',
    reviewedBy: 'octocat',
    reviewedAt: '2026-11-02T10:00:00Z',
  }),
  snapshot({
    id: 'snap-removed',
    storyId: 'legacy--old',
    state: 'removed',
    baselineHash: hash('8'),
    width: null,
    height: null,
    review: 'approved',
  }),
  snapshot({
    id: 'snap-unchanged',
    storyId: 'text--body',
    title: 'Text',
    name: 'Body',
    state: 'unchanged',
    imageHash: hash('9'),
    baselineHash: hash('9'),
    review: 'approved',
  }),
  snapshot({
    id: 'snap-error',
    buildId: mainBuild.id,
    storyId: 'chart--line',
    title: 'Chart',
    name: 'Line',
    state: 'error',
    baselineHash: hash('a'),
    width: null,
    height: null,
  }),
  snapshot({
    id: 'snap-unstable',
    buildId: mainBuild.id,
    storyId: 'spinner--default',
    title: 'Spinner',
    name: 'Default',
    state: 'unstable',
    imageHash: hash('b'),
    baselineHash: hash('c'),
    diffHash: hash('d'),
    diffRatio: 0.05,
  }),
];

/** A fresh copy per test, since the MSW API mutates its state. */
export function initialSnapshots(): Snapshot[] {
  return snapshots.map((snapshot) => ({ ...snapshot }));
}

/** Build #10: the accepted main build the library shows. */
const libraryBuild: Build = {
  ...mainBuild,
  id: 'build-10',
  number: 10,
  status: 'accepted',
  createdAt: '2026-10-30T10:00:00Z',
};

/** Four stories of three components; the last has no title, no name and a variant. */
export function initialLibrary(): GetLibraryResponse {
  const story = (storyId: string, title: string, name: string, digit: string) => ({
    storyId,
    variant: 'default',
    title,
    name,
    imageHash: hash(digit),
  });
  return {
    platform: 'ios',
    platforms: ['ios'],
    build: libraryBuild,
    stories: [
      story('button--primary', 'Button', 'Primary', '1'),
      story('button--secondary', 'Button', 'Secondary', '2'),
      story('card--default', 'Forms/Card', 'Default', '3'),
      { storyId: 'legacy--old', variant: 'dark', title: null, name: null, imageHash: hash('4') },
    ],
  };
}
