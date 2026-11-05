import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { imageHash, newProject } from '../../test/support/fixtures.js';
import { createApprovalRepository } from './approval.repository.js';
import { createProjectRepository } from './project.repository.js';

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

  it('tells whether a hash pair is approved and deletes exactly that pair', async () => {
    await createProjectRepository(env.DB).create(newProject('appr-pair'));
    const repository = createApprovalRepository(env.DB);
    const changed = {
      projectId: 'project-appr-pair',
      storyId: 'card',
      variant: 'default',
      fromHash: imageHash('1'),
      toHash: imageHash('2'),
      approvedBy: 'octocat',
      approvedAt: '2026-01-01T00:00:00.000Z',
    };
    const fresh = { ...changed, fromHash: null };
    await repository.create('pair-1', changed);
    await repository.create('pair-2', fresh);

    const pair = ['project-appr-pair', 'card', 'default'] as const;
    expect(await repository.exists(...pair, imageHash('1'), imageHash('2'))).toBe(true);
    expect(await repository.exists(...pair, null, imageHash('2'))).toBe(true);
    expect(await repository.exists(...pair, imageHash('3'), imageHash('2'))).toBe(false);
    expect(await repository.exists('project-appr-pair', 'card', 'dark', null, imageHash('2'))).toBe(
      false,
    );

    await repository.delete(...pair, null, imageHash('2'));

    expect(await repository.exists(...pair, null, imageHash('2'))).toBe(false);
    expect(await repository.listForProject('project-appr-pair')).toEqual([changed]);
  });
});
