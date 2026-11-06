import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { imageHash, newProject } from '../../test/support/fixtures.ts';
import { createApprovalRepository } from './approval.repository.ts';
import { createProjectRepository } from './project.repository.ts';

/** An approval of the `new` story `card` (no previous image) moving to image 2. */
function approval(projectId: string) {
  return {
    projectId,
    storyId: 'card',
    variant: 'default',
    fromHash: null,
    toHash: imageHash('2'),
    approvedBy: 'octocat',
    approvedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('createApprovalRepository (local D1)', () => {
  it('creates approvals and lists those of one project, oldest first', async () => {
    const projects = createProjectRepository(env.DB);
    await projects.create(newProject('appr-a'));
    await projects.create(newProject('appr-b'));
    const repository = createApprovalRepository(env.DB);
    const later = {
      projectId: 'project-appr-a',
      storyId: 'button--primary',
      variant: 'default',
      fromHash: imageHash('1'),
      toHash: imageHash('2'),
      approvedBy: 'octocat',
      approvedAt: '2026-01-02T00:00:00.000Z',
    };
    const earlier = { ...later, fromHash: null, approvedAt: '2026-01-01T00:00:00.000Z' };

    await repository.create('approval-2', later);
    await repository.create('approval-1', earlier);
    await repository.create('approval-3', { ...later, projectId: 'project-appr-b' });

    expect(await repository.listForProject('project-appr-a')).toEqual([earlier, later]);
    expect(await repository.listForProject('project-none')).toEqual([]);
  });

  it('deletes exactly the given hash pair', async () => {
    await createProjectRepository(env.DB).create(newProject('appr-pair'));
    const repository = createApprovalRepository(env.DB);
    const changed = { ...approval('project-appr-pair'), fromHash: imageHash('1') };
    const fresh = { ...changed, fromHash: null };
    const dark = { ...fresh, variant: 'dark' };
    await repository.create('pair-1', changed);
    await repository.create('pair-2', fresh);
    await repository.create('pair-3', dark);

    await repository.delete('project-appr-pair', 'card', 'default', null, imageHash('2'));

    expect(await repository.listForProject('project-appr-pair')).toEqual([changed, dark]);
  });
});

describe('createApprovalRepository identity (local D1)', () => {
  it('keeps the first approval of a hash pair and ignores a repeat', async () => {
    await createProjectRepository(env.DB).create(newProject('appr-dup'));
    const repository = createApprovalRepository(env.DB);
    const first = { ...approval('project-appr-dup'), fromHash: imageHash('1') };

    await repository.create('dup-1', first);
    await repository.create('dup-2', { ...first, approvedBy: 'hubot' });

    expect(await repository.listForProject('project-appr-dup')).toEqual([first]);
  });

  it('also ignores a repeated approval of a new story, whose fromHash is null', async () => {
    await createProjectRepository(env.DB).create(newProject('appr-null'));
    const repository = createApprovalRepository(env.DB);
    const first = approval('project-appr-null');
    const otherImage = { ...first, toHash: imageHash('3') };

    await Promise.all([
      repository.create('null-1', first),
      repository.create('null-2', { ...first, approvedBy: 'hubot' }),
    ]);
    await repository.create('null-3', otherImage);

    const stored = await repository.listForProject('project-appr-null');
    expect(stored).toHaveLength(2);
    expect(stored.filter((row) => row.toHash === imageHash('2'))).toHaveLength(1);
    expect(stored).toContainEqual(otherImage);
  });
});
