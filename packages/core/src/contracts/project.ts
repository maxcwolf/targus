import { z } from 'zod';

/** `owner/name` on github.com. */
export const RepoFullName = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'expected a GitHub repository as owner/name');
export type RepoFullName = z.infer<typeof RepoFullName>;

/**
 * `POST /api/admin/projects` request body, authenticated by the admin token (plan.md section
 * 12: projects are created by a maintainer, not through a UI). Creates the org row when the
 * GitHub org is new. `installationId` is the GitHub App installation on that org; null means
 * check runs are skipped until it is set.
 */
export const CreateProjectRequest = z.object({
  githubOrg: z.string().min(1),
  installationId: z.number().int().positive().nullable(),
  repo: RepoFullName,
  name: z.string().min(1),
  defaultBranch: z.string().min(1).default('main'),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

/** The project token is returned exactly once; the server stores only its hash. */
export const CreateProjectResponse = z.object({
  project: z.object({
    id: z.string().min(1),
    orgId: z.string().min(1),
    repo: RepoFullName,
    name: z.string().min(1),
    defaultBranch: z.string().min(1),
  }),
  token: z.string().min(32),
});
export type CreateProjectResponse = z.infer<typeof CreateProjectResponse>;

/** A project as the review UI lists it and the CLI checks it: never the token hash. */
export const ProjectSummary = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  githubOrg: z.string().min(1),
  repo: RepoFullName,
  name: z.string().min(1),
  defaultBranch: z.string().min(1),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

/**
 * `GET /api/projects/current` response: the project the bearer token belongs to, or 401. The
 * CLI asks before it captures, so a wrong token fails in seconds rather than after the capture.
 */
export const CurrentProjectResponse = z.object({ project: ProjectSummary });
export type CurrentProjectResponse = z.infer<typeof CurrentProjectResponse>;
