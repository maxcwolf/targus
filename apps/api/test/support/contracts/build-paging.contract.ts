import { describe, expect, it } from 'vitest';

import type { ApiBuildRepository, BuildPage } from '../../../src/ports/build-repository.ts';
import { newBuild } from '../fixtures.ts';
import type { BuildHarness } from './build-harness.ts';

/** Create `count` builds of a project, all with the same `createdAt` (the fake clock epoch). */
async function createBuilds(
  repository: ApiBuildRepository,
  projectId: string,
  count: number,
): Promise<void> {
  for (let index = 1; index <= count; index += 1) {
    await repository.create(newBuild(`${projectId}-b${String(index)}`, projectId));
  }
}

/** Every page of a project's builds, following `nextCursor` until it is null. */
async function allPages(
  repository: ApiBuildRepository,
  projectId: string,
  limit: number,
): Promise<BuildPage[]> {
  const pages = [await repository.listForProject(projectId, { limit })];
  for (let cursor = pages[0]?.nextCursor; cursor; cursor = pages.at(-1)?.nextCursor) {
    pages.push(await repository.listForProject(projectId, { limit, cursor }));
  }
  return pages;
}

const numbers = (page: BuildPage | undefined): number[] =>
  page?.builds.map((build) => build.number) ?? [];

type Harness = () => BuildHarness;

function describeOrder(name: string, harness: Harness): void {
  describe(`${name} listForProject paging`, () => {
    it('pages builds created in the same millisecond newest first, none skipped or repeated', async () => {
      const { repository, seedProject } = harness();
      const projectId = await seedProject('page-ties');
      await createBuilds(repository, projectId, 5);

      const pages = await allPages(repository, projectId, 2);

      expect(pages.map(numbers)).toEqual([[5, 4], [3, 2], [1]]);
      expect(pages.map((page) => page.nextCursor === null)).toEqual([false, false, true]);
    });

    it('ends with a null cursor when the last page is exactly full', async () => {
      const { repository, seedProject } = harness();
      const projectId = await seedProject('page-full');
      await createBuilds(repository, projectId, 4);

      expect((await allPages(repository, projectId, 2)).map(numbers)).toEqual([
        [4, 3],
        [2, 1],
      ]);
      const whole = await repository.listForProject(projectId, { limit: 4 });
      expect(whole.nextCursor).toBeNull();
      expect(await repository.listForProject('project-none', { limit: 3 })).toEqual({
        builds: [],
        nextCursor: null,
      });
    });

    it('keeps reading older builds when new ones arrive between pages', async () => {
      const { repository, seedProject } = harness();
      const projectId = await seedProject('page-new');
      await createBuilds(repository, projectId, 3);
      const first = await repository.listForProject(projectId, { limit: 2 });
      await repository.create(newBuild(`${projectId}-late`, projectId));

      const second = await repository.listForProject(projectId, {
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      });

      expect([numbers(first), numbers(second)]).toEqual([[3, 2], [1]]);
      expect(second.nextCursor).toBeNull();
    });
  });
}

function describeValidation(name: string, harness: Harness): void {
  describe(`${name} listForProject validation`, () => {
    it('rejects a cursor it did not issue and a limit out of range as bad_request', async () => {
      const { repository, seedProject } = harness();
      const projectId = await seedProject('page-bad');
      const forged = [btoa('n:0'), btoa('x:1'), btoa('n:1.5'), 'not base64!', '====', 'a'];
      for (const cursor of forged) {
        await expect(
          repository.listForProject(projectId, { limit: 2, cursor }),
        ).rejects.toMatchObject({ code: 'bad_request' });
      }
      for (const limit of [0, 101, 1.5]) {
        await expect(repository.listForProject(projectId, { limit })).rejects.toMatchObject({
          code: 'bad_request',
        });
      }
    });
  });
}

/**
 * The paging behaviour of `listForProject`, run against both the D1 adapter and the in-memory
 * double so the double cannot drift from what D1 does.
 */
export function describeBuildPaging(name: string, harness: Harness): void {
  describeOrder(name, harness);
  describeValidation(name, harness);
}
