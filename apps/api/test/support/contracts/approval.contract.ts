import type { Approval } from '@targus/core';
import { describe, expect, it } from 'vitest';

import type { ApprovalRepository } from '../../../src/repositories/approval.repository.ts';
import { imageHash } from '../fixtures.ts';

/** An approvals repository, D1's or the double's, and how to make a project to approve in. */
export interface ApprovalHarness {
  readonly repository: ApprovalRepository;
  /** A project id approvals may belong to; `key` is unique per call. */
  readonly seedProject: (key: string) => Promise<string>;
}

type Harness = () => ApprovalHarness;

/** An approval of story `card` moving from image 1 to image 2, on 2026-01-01. */
function approvalOf(projectId: string, overrides: Partial<Approval> = {}): Approval {
  return {
    projectId,
    storyId: 'card',
    variant: 'default',
    fromHash: imageHash('1'),
    toHash: imageHash('2'),
    approvedBy: 'octocat',
    approvedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function listsOldestFirst({ repository, seedProject }: ApprovalHarness): Promise<void> {
  const projectId = await seedProject('ac-order');
  const otherId = await seedProject('ac-order-other');
  const later = approvalOf(projectId, { storyId: 'later', approvedAt: '2026-01-02T00:00:00Z' });
  const tieB = approvalOf(projectId, { storyId: 'tie-b' });
  const tieA = approvalOf(projectId, { storyId: 'tie-a', fromHash: null });

  await repository.create('ac-order-3', later);
  await repository.create('ac-order-2', tieB);
  await repository.create('ac-order-1', tieA);
  await repository.create('ac-order-4', approvalOf(otherId));

  // Oldest first, ties by id; approvedAt reads back as ISO with milliseconds.
  expect(await repository.listForProject(projectId)).toEqual([
    tieA,
    tieB,
    { ...later, approvedAt: '2026-01-02T00:00:00.000Z' },
  ]);
  expect(await repository.listForProject('project-none')).toEqual([]);
}

async function keepsFirstOfPair({ repository, seedProject }: ApprovalHarness): Promise<void> {
  const projectId = await seedProject('ac-dup');
  const changed = approvalOf(projectId);
  const fresh = approvalOf(projectId, { fromHash: null });
  const dark = approvalOf(projectId, { variant: 'dark' });
  const otherImage = approvalOf(projectId, { fromHash: null, toHash: imageHash('3') });

  await repository.create('ac-dup-1', changed);
  await repository.create('ac-dup-2', { ...changed, approvedBy: 'hubot' });
  // A null fromHash too, even when the two arrive together.
  await Promise.all([
    repository.create('ac-dup-3', fresh),
    repository.create('ac-dup-4', { ...fresh, approvedBy: 'hubot' }),
  ]);
  await repository.create('ac-dup-5', dark);
  await repository.create('ac-dup-6', otherImage);

  // Either of the two racing new-story approvals may win, but only one is stored.
  expect(await repository.listForProject(projectId)).toEqual([
    changed,
    { ...fresh, approvedBy: expect.any(String) as string },
    dark,
    otherImage,
  ]);
}

async function ignoresTakenId({ repository, seedProject }: ApprovalHarness): Promise<void> {
  const projectId = await seedProject('ac-id');
  const first = approvalOf(projectId);

  await repository.create('ac-id-1', first);
  await repository.create('ac-id-1', approvalOf(projectId, { storyId: 'other' }));

  expect(await repository.listForProject(projectId)).toEqual([first]);
}

async function deletesThePair({ repository, seedProject }: ApprovalHarness): Promise<void> {
  const projectId = await seedProject('ac-del');
  const changed = approvalOf(projectId);
  const fresh = approvalOf(projectId, { fromHash: null });
  const dark = approvalOf(projectId, { fromHash: null, variant: 'dark' });
  await repository.create('ac-del-1', changed);
  await repository.create('ac-del-2', fresh);
  await repository.create('ac-del-3', dark);

  await repository.delete(projectId, 'card', 'default', null, imageHash('2'));
  await repository.delete(projectId, 'card', 'default', imageHash('9'), imageHash('2'));

  expect(await repository.listForProject(projectId)).toEqual([changed, dark]);
  // The pair, and its id, may be approved again.
  await repository.create('ac-del-2', fresh);
  expect(await repository.listForProject(projectId)).toEqual([changed, fresh, dark]);
}

/** The contract of `ApprovalRepository`, for the D1 adapter and the in-memory double. */
export function describeApprovalContract(name: string, harness: Harness): void {
  describe(`${name} approvals`, () => {
    it('lists the approvals of one project oldest first, ties by id', () =>
      listsOldestFirst(harness()));
    it('keeps the first approval of a hash pair, a null fromHash included', () =>
      keepsFirstOfPair(harness()));
    it('ignores an approval whose id is taken', () => ignoresTakenId(harness()));
    it('deletes exactly the given hash pair, after which it may be approved again', () =>
      deletesThePair(harness()));
  });
}
