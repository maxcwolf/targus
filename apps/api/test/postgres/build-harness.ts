import type { BuildHarness } from '../support/contracts/build-harness.ts';
import { newProject } from '../support/fixtures.ts';
import type { TestPostgres } from './database.ts';

/** The Postgres builds repository, whose builds need a project row (foreign key). */
export function postgresBuildHarness({ repositories }: TestPostgres): BuildHarness {
  return {
    repository: repositories.builds,
    approvals: repositories.approvals,
    async seedProject(key) {
      return (await repositories.projects.create(newProject(key))).id;
    },
  };
}
