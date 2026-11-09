import type { Approval } from '@targus/core';

import type { ApprovalRepository, ApprovalIdentity } from '../../src/ports/approval-repository.ts';
import type { ProjectRepository } from '../../src/ports/project-repository.ts';
import { compareText, foreignKeyViolation } from './d1-semantics.ts';

// The in-memory double of the approvals repository. It and the D1 adapter run the same
// contract suite (test/support/contracts/approval.contract.ts).

/**
 * The approvals double. `all` holds the approvals in insertion order; `listForProject` orders
 * them as D1 does. An approval names a project of `projects`, as D1's foreign key on project_id
 * requires. `record` and `withdraw` apply at once, with no await, so the builds double's
 * `commitReview` can change approvals in the same step as the decision, as D1's batch does;
 * `record` skips the foreign key, since a committed review's build already has its project.
 */
export interface InMemoryApprovals extends ApprovalRepository {
  readonly all: Approval[];
  record(id: string, approval: Approval): void;
  withdraw(pair: ApprovalIdentity): void;
}

/** Whether an approval is of this story's hash pair. */
const samePair = (pair: ApprovalIdentity) => (approval: Approval) =>
  approval.projectId === pair.projectId &&
  approval.storyId === pair.storyId &&
  approval.variant === pair.variant &&
  approval.fromHash === pair.fromHash &&
  approval.toHash === pair.toHash;

export function createInMemoryApprovals(
  projects: Pick<ProjectRepository, 'findById'>,
): InMemoryApprovals {
  const all: Approval[] = [];
  const ids = new Map<Approval, string>();
  const oldestFirst = (a: Approval, b: Approval) =>
    compareText(a.approvedAt, b.approvedAt) || compareText(ids.get(a) ?? '', ids.get(b) ?? '');
  const record = (id: string, input: Approval) => {
    // ON CONFLICT DO NOTHING with no target: the primary key and both identity indexes (a null
    // fromHash included) each make it a no-op. D1 stores approvedAt as epoch milliseconds.
    const approval = { ...input, approvedAt: new Date(input.approvedAt).toISOString() };
    const taken = [...ids.values()].includes(id);
    if (taken || all.some(samePair(approval))) return;
    all.push(approval);
    ids.set(approval, id);
  };
  const withdraw = (pair: ApprovalIdentity) => {
    const keep = all.filter((approval) => !samePair(pair)(approval));
    for (const gone of all.filter((approval) => !keep.includes(approval))) ids.delete(gone);
    all.splice(0, all.length, ...keep);
  };
  return {
    all,
    record,
    withdraw,
    listForProject: (projectId) =>
      Promise.resolve(all.filter((a) => a.projectId === projectId).sort(oldestFirst)),
    async create(id, input) {
      // The foreign key first: ON CONFLICT DO NOTHING does not cover it.
      if ((await projects.findById(input.projectId)) === null) {
        return foreignKeyViolation('approvals.project_id');
      }
      record(id, input);
    },
    delete(projectId, storyId, variant, fromHash, toHash) {
      withdraw({ projectId, storyId, variant, fromHash, toHash });
      return Promise.resolve();
    },
  };
}
