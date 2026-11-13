import { z } from 'zod';

import { RepoFullName } from './project.ts';

/** A GitHub App installation id, as GitHub numbers them. */
export const InstallationId = z.coerce.number().int().positive();

/** An installation of the GitHub App, and the account (an org or a user) it is on. */
export const InstallationSummary = z.object({
  installationId: z.number().int().positive(),
  account: z.string().min(1),
});
export type InstallationSummary = z.infer<typeof InstallationSummary>;

/**
 * `GET /api/installations` response: the installations the reviewer already has a project
 * under, and `installUrl`, GitHub's page for installing the App on another account (null when
 * the server does not know the App's name).
 */
export const ListInstallationsResponse = z.object({
  installations: z.array(InstallationSummary),
  installUrl: z.url().nullable(),
});
export type ListInstallationsResponse = z.infer<typeof ListInstallationsResponse>;

/** A repository an installation can see, and its project if it has one. */
export const InstallationRepo = z.object({
  repo: RepoFullName,
  defaultBranch: z.string().min(1),
  projectId: z.string().min(1).nullable(),
});
export type InstallationRepo = z.infer<typeof InstallationRepo>;

/** `GET /api/installations/:id/repos` response, repositories in name order. */
export const ListInstallationReposResponse = z.object({
  account: z.string().min(1),
  repos: z.array(InstallationRepo),
});
export type ListInstallationReposResponse = z.infer<typeof ListInstallationReposResponse>;

/**
 * `POST /api/installations/:id/projects` request body: the repository to make a project for.
 * The answer is a `CreateProjectResponse`, which carries the project's token exactly once.
 */
export const CreateInstallationProjectRequest = z.object({
  repo: RepoFullName,
});
export type CreateInstallationProjectRequest = z.infer<typeof CreateInstallationProjectRequest>;
