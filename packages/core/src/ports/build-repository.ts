import type { Build } from '../contracts/build.js';
import type { Snapshot } from '../contracts/snapshot.js';

/** Fields the caller supplies when a build is opened; the repository assigns `number`. */
export type NewBuild = Omit<Build, 'number'>;

/**
 * Persistence for builds and their snapshots (plan.md section 6). The API adapter is
 * `D1BuildRepository`. Every query is scoped by project, and projects by org (ADR 0007).
 */
export interface BuildRepository {
  /** Insert a build, assigning the next per-project build number. */
  create(build: NewBuild): Promise<Build>;
  /** Read one build of a project, or `null` when it does not exist in that project. */
  findById(projectId: string, buildId: string): Promise<Build | null>;
  /**
   * The most recent successful build whose sha is the first of `shas` that has one. Used for
   * baseline resolution: `shas` is the merge base followed by its first-parent ancestors.
   */
  findLatestSuccessfulForShas(projectId: string, shas: readonly string[]): Promise<Build | null>;
  /** Every snapshot of a build. */
  listSnapshots(buildId: string): Promise<Snapshot[]>;
}
