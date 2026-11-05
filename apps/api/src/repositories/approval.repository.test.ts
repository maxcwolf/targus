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
});
