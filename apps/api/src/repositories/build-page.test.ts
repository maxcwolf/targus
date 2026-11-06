import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { describeBuildPaging } from '../../test/support/build-paging-suite.ts';
import { newProject } from '../../test/support/fixtures.ts';
import { createInMemoryBuilds } from '../../test/support/in-memory-builds.ts';
import { decodeBuildCursor, encodeBuildCursor } from './build-page.ts';
import { D1BuildRepository } from './build.repository.ts';
import { createProjectRepository } from './project.repository.ts';

describe('build cursors', () => {
  it('round-trip a build number through URL-safe text', () => {
    for (const number of [1, 62, 63, 999_999, Number.MAX_SAFE_INTEGER]) {
      const cursor = encodeBuildCursor(number);
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeBuildCursor(cursor)).toBe(number);
    }
  });
});

describeBuildPaging('D1BuildRepository (local D1)', () => ({
  repository: new D1BuildRepository(env.DB),
  async seedProject(key) {
    const project = await createProjectRepository(env.DB).create(newProject(`d1-${key}`));
    return project.id;
  },
}));

describeBuildPaging('in-memory builds double', () => ({
  repository: createInMemoryBuilds(),
  seedProject: (key) => Promise.resolve(`project-mem-${key}`),
}));
