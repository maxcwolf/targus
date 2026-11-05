import { z } from 'zod';

/** What started a build: a pull request or a push to the default branch. */
export const BuildTrigger = z.enum(['pr', 'main']);
export type BuildTrigger = z.infer<typeof BuildTrigger>;

/**
 * Lifecycle and review outcome of a build, matching the status chips in plan.md section 5.3.
 * `in_progress` while the CLI is still uploading, `failed` when capture failed.
 */
export const BuildStatus = z.enum([
  'in_progress',
  'pending',
  'accepted',
  'denied',
  'passed',
  'failed',
]);
export type BuildStatus = z.infer<typeof BuildStatus>;

/** A full 40-character git commit sha, lowercase hex. */
export const GitSha = z.string().regex(/^[0-9a-f]{40}$/, 'expected a full 40-character git sha');

/** One CI run of one project, as stored in the `builds` table. */
export const Build = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  number: z.number().int().positive(),
  sha: GitSha,
  branch: z.string().min(1),
  prNumber: z.number().int().positive().nullable(),
  mergeBaseSha: GitSha.nullable(),
  baselineBuildId: z.string().min(1).nullable(),
  trigger: BuildTrigger,
  device: z.string().min(1),
  status: BuildStatus,
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type Build = z.infer<typeof Build>;
