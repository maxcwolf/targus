import { baselineResolutionCases, baselineShaOrder, emptyTally } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { isForeignKeyViolation } from '../d1-semantics.ts';
import { newBuild, sha } from '../fixtures.ts';
import { completedAt, openBuild, type BuildHarness } from './build-harness.ts';

// Creating and reading builds, and the two baseline lookups. Results, reviews and paging have
// suites of their own (build-results, build-review, build-paging).

type Harness = () => BuildHarness;

const tally = {
  counts: { unchanged: 1, changed: 2, new: 3, removed: 4, unstable: 5, error: 6 },
  pendingCount: 7,
  deniedCount: 8,
};

async function numbersPerProject({ repository, seedProject }: BuildHarness): Promise<void> {
  const projectA = await seedProject('bc-num-a');
  const projectB = await seedProject('bc-num-b');

  const first = await repository.create(newBuild('bc-a1', projectA));
  const second = await repository.create(newBuild('bc-a2', projectA, { prNumber: 12 }), tally);
  const other = await repository.create(newBuild('bc-b1', projectB));

  expect([first.number, second.number, other.number]).toEqual([1, 2, 1]);
  expect(first).toEqual({ ...newBuild('bc-a1', projectA), number: 1, tally: emptyTally });
  expect(second.tally).toEqual(tally);
  expect(await repository.findById(projectA, 'bc-a2')).toEqual(second);
  expect(await repository.findById(projectB, 'bc-a2')).toBeNull();
  expect(await repository.findAnyById('bc-a2')).toEqual(second);
  expect(await repository.findAnyById('bc-none')).toBeNull();
}

async function rejectsTakenId(harness: BuildHarness): Promise<void> {
  const { repository } = harness;
  const { projectId, buildId } = await openBuild(harness, 'bc-taken');
  const stored = await repository.findById(projectId, buildId);

  await expect(
    repository.create(newBuild(buildId, projectId, { branch: 'other' })),
  ).rejects.toThrow();

  expect(await repository.findById(projectId, buildId)).toEqual(stored);
  expect((await repository.create(newBuild('bc-taken-2', projectId))).number).toBe(2);
}

async function rejectsMissingProject({ repository, seedProject }: BuildHarness): Promise<void> {
  await expect(repository.create(newBuild('bc-orphan', 'project-bc-none'))).rejects.toSatisfy(
    isForeignKeyViolation,
  );

  // Nothing was stored: the id is free for a build of a real project, which is its first.
  expect(await repository.findAnyById('bc-orphan')).toBeNull();
  const projectId = await seedProject('bc-orphan');
  expect((await repository.create(newBuild('bc-orphan', projectId))).number).toBe(1);
}

async function oneBuildPerKey({ repository, seedProject }: BuildHarness): Promise<void> {
  const projectA = await seedProject('bc-key-a');
  const projectB = await seedProject('bc-key-b');
  const keyed = (id: string, projectId: string, idempotencyKey: string | null = 'run-1') => ({
    ...newBuild(id, projectId),
    idempotencyKey,
  });

  const first = await repository.create(keyed('bc-key-1', projectA));
  const replays = await Promise.all([
    repository.create({ ...keyed('bc-key-2', projectA), branch: 'other' }, tally),
    repository.create(keyed('bc-key-3', projectA)),
    repository.create(keyed('bc-key-1', projectA)),
  ]);
  const other = await repository.create(keyed('bc-key-4', projectB));
  const unkeyed = [
    await repository.create(keyed('bc-key-5', projectA, null)),
    await repository.create(newBuild('bc-key-6', projectA)),
    await repository.create(keyed('bc-key-7', projectA, 'run-2')),
  ];

  expect(replays).toEqual([first, first, first]);
  expect(await repository.findById(projectA, 'bc-key-2')).toBeNull();
  expect(await repository.findById(projectA, 'bc-key-3')).toBeNull();
  expect([other.id, other.number]).toEqual(['bc-key-4', 1]);
  expect(unkeyed.map((build) => build.number)).toEqual([2, 3, 4]);
  await expect(repository.create(keyed('bc-key-1', projectA, 'run-3'))).rejects.toThrow();
}

async function storesCompletionAndCheckRun(harness: BuildHarness): Promise<void> {
  const { repository } = harness;
  const { projectId, buildId } = await openBuild(harness, 'bc-status');

  expect(
    await repository.completeWithResults(buildId, [], {
      status: 'denied',
      tally,
      completedAt,
      resultsDigest: 'digest',
    }),
  ).toBe(true);
  await repository.setCheckRunId(buildId, 55);
  await repository.setCheckRunId('bc-none', 56);

  expect(await repository.findById(projectId, buildId)).toMatchObject({
    status: 'denied',
    completedAt: completedAt.toISOString(),
    checkRunId: 55,
    tally,
  });
  expect(await repository.findAnyById('bc-none')).toBeNull();
}

async function claimsCheckRunCreation(harness: BuildHarness): Promise<void> {
  const { repository } = harness;
  const { projectId, buildId } = await openBuild(harness, 'bc-claim');
  const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms);
  const staleBefore = at(-60_000);

  expect(await repository.claimCheckRun(buildId, at(0), staleBefore)).toBe(true);
  expect(await repository.claimCheckRun(buildId, at(1), staleBefore)).toBe(false);
  expect(await repository.findById(projectId, buildId)).toMatchObject({ checkRunId: null });
  // Another request's release leaves the claim alone; the claimer's own frees it.
  await repository.releaseCheckRunClaim(buildId, at(1));
  expect(await repository.claimCheckRun(buildId, at(2), staleBefore)).toBe(false);
  await repository.releaseCheckRunClaim(buildId, at(0));
  expect(await repository.claimCheckRun(buildId, at(3), staleBefore)).toBe(true);
  // A claim older than `staleBefore` is taken over.
  expect(await repository.claimCheckRun(buildId, at(120_000), at(60_000))).toBe(true);

  await repository.setCheckRunId(buildId, 57);
  expect(await repository.claimCheckRun(buildId, at(200_000), at(300_000))).toBe(false);
  expect(await repository.findById(projectId, buildId)).toMatchObject({ checkRunId: 57 });
  expect(await repository.claimCheckRun('bc-none', at(0), staleBefore)).toBe(false);
}

async function latestBaselineOnBranch({ repository, seedProject }: BuildHarness): Promise<void> {
  const projectId = await seedProject('bc-lib-a');
  const otherId = await seedProject('bc-lib-b');
  await repository.create(newBuild('bc-lib-1', projectId, { status: 'passed' }));
  await repository.create(newBuild('bc-lib-2', projectId, { status: 'accepted' }));
  await repository.create(newBuild('bc-lib-3', projectId, { status: 'pending' }));
  await repository.create(newBuild('bc-lib-4', projectId, { status: 'accepted', branch: 'dev' }));
  await repository.create(newBuild('bc-lib-5', otherId, { status: 'failed' }));

  expect((await repository.findLatestBaselineOnBranch(projectId, 'main'))?.id).toBe('bc-lib-2');
  expect((await repository.findLatestBaselineOnBranch(projectId, 'dev'))?.id).toBe('bc-lib-4');
  expect(await repository.findLatestBaselineOnBranch(otherId, 'main')).toBeNull();
  expect(await repository.findLatestBaselineOnBranch(projectId, 'none')).toBeNull();
}

async function longShaOrder({ repository, seedProject }: BuildHarness): Promise<void> {
  const projectId = await seedProject('bc-long');
  const ancestors = Array.from({ length: 100 }, (_, index) => index.toString(16).padStart(40, '0'));
  const last = ancestors.at(-1) ?? sha('f');
  await repository.create(newBuild('bc-long-1', projectId, { sha: last, status: 'passed' }));

  const found = await repository.findLatestSuccessfulForShas(
    projectId,
    baselineShaOrder(sha('e'), ancestors),
  );

  expect(found?.id).toBe('bc-long-1');
}

async function successfulScopedByProject({ repository, seedProject }: BuildHarness): Promise<void> {
  const projectId = await seedProject('bc-scoped-a');
  const otherId = await seedProject('bc-scoped-b');
  await repository.create(newBuild('bc-scoped-1', otherId, { sha: sha('a'), status: 'passed' }));

  expect(await repository.findLatestSuccessfulForShas(projectId, [sha('a')])).toBeNull();
  expect(await repository.findLatestSuccessfulForShas(otherId, [])).toBeNull();
}

type ResolutionCase = (typeof baselineResolutionCases)[number] & { readonly index: number };

/** One of core's `baselineResolutionCases`, run through the repository. */
async function resolvesLikeCore(
  { repository, seedProject }: BuildHarness,
  { index, mergeBaseSha, ancestors, candidates, expectedBuildId }: ResolutionCase,
): Promise<void> {
  const projectId = await seedProject(`bc-case-${index}`);
  const prefix = `bc-case-${index}-`;
  for (const candidate of candidates) {
    const { sha: onSha, status, createdAt } = candidate;
    await repository.create(
      newBuild(`${prefix}${candidate.id}`, projectId, { sha: onSha, status, createdAt }),
    );
  }

  const found = await repository.findLatestSuccessfulForShas(
    projectId,
    baselineShaOrder(mergeBaseSha, ancestors),
  );

  expect(found?.id ?? null).toBe(expectedBuildId === null ? null : `${prefix}${expectedBuildId}`);
}

/** Creating and reading builds, and the baseline lookups, of a builds repository. */
export function describeBuildContract(name: string, harness: Harness): void {
  describe(`${name} builds`, () => {
    it('numbers builds per project and reads them back scoped by project', () =>
      numbersPerProject(harness()));
    it('rejects a build whose id is taken, keeping the first and its number', () =>
      rejectsTakenId(harness()));
    it('rejects a build of a project that does not exist, storing nothing', () =>
      rejectsMissingProject(harness()));
    it('opens one build per idempotency key and project, returning it to every replay', () =>
      oneBuildPerKey(harness()));
    it('stores the completion, its tally and the check run id', () =>
      storesCompletionAndCheckRun(harness()));
    it('lets one request at a time claim creating the check run', () =>
      claimsCheckRunCreation(harness()));
    it('finds the newest signed-off build of a branch within the project', () =>
      latestBaselineOnBranch(harness()));
  });

  describe(`${name} findLatestSuccessfulForShas`, () => {
    const cases = baselineResolutionCases.map((testCase, index) => ({ ...testCase, index }));
    it.each(cases)('agrees with resolveBaseline: $name', (testCase) =>
      resolvesLikeCore(harness(), testCase),
    );
    it('handles the full 101-sha order the CLI can send', () => longShaOrder(harness()));
    it('ignores builds of other projects and an empty order', () =>
      successfulScopedByProject(harness()));
  });
}
