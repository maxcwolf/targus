import type {
  ApproveAllResponse,
  CreateBuildRequest,
  CreateBuildResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  GetBuildResponse,
  GetLibraryResponse,
  HealthResponse,
  ListBuildsQuery,
  ListBuildsResponse,
  ListProjectsResponse,
  ListSnapshotsResponse,
  ReviewDecision,
  ReviewSnapshotResponse,
  SubmitResultsRequest,
  SubmitResultsResponse,
  UploadImageResponse,
} from '@targus/core';

import type { Project } from '../repositories/project.repository.ts';
import {
  authenticateAdmin,
  authenticateProjectToken,
  authenticateSession,
} from './auth.service.ts';
import { createBuild, getBuild, listBuilds, listSnapshots } from './build.service.ts';
import type { ServiceDeps } from './deps.ts';
import { getHealth } from './health.service.ts';
import { getImage, uploadImage } from './image.service.ts';
import { getLibrary } from './library.service.ts';
import {
  beginLogin,
  completeLogin,
  cookieSettings,
  logout,
  type CookieSettings,
  type LoginCallback,
  type LoginRedirect,
  type NewLogin,
} from './login.service.ts';
import { assertSameOrigin, type RequestOrigin } from './origin.service.ts';
import type { Principal, Reviewer } from './principal.ts';
import { createProject, listProjects } from './project.service.ts';
import { submitResults } from './results.service.ts';
import { approveAll, reviewSnapshot } from './review.service.ts';

/** The use-cases with their dependencies bound: what routes and middleware call. */
export interface Services {
  getHealth(): HealthResponse;
  authenticateAdmin(token: string | null): Promise<void>;
  authenticateProjectToken(token: string | null): Promise<Project>;
  authenticateSession(sessionId: string | null): Promise<Reviewer>;
  /** Throws `forbidden` for a cookie-authenticated write from another origin (ADR 0015). */
  assertSameOrigin(request: RequestOrigin): void;
  /** How to sign cookies; null when `SESSION_SECRET` is not set. */
  cookieSettings(): CookieSettings | null;
  beginLogin(returnTo: string | undefined): LoginRedirect;
  completeLogin(callback: LoginCallback): Promise<NewLogin>;
  logout(sessionId: string): Promise<void>;
  createProject(request: CreateProjectRequest): Promise<CreateProjectResponse>;
  listProjects(reviewer: Reviewer): Promise<ListProjectsResponse>;
  listBuilds(
    reviewer: Reviewer,
    projectId: string,
    query?: ListBuildsQuery,
  ): Promise<ListBuildsResponse>;
  getLibrary(reviewer: Reviewer, projectId: string): Promise<GetLibraryResponse>;
  createBuild(project: Project, request: CreateBuildRequest): Promise<CreateBuildResponse>;
  getBuild(principal: Principal, buildId: string): Promise<GetBuildResponse>;
  listSnapshots(principal: Principal, buildId: string): Promise<ListSnapshotsResponse>;
  submitResults(
    project: Project,
    buildId: string,
    request: SubmitResultsRequest,
  ): Promise<SubmitResultsResponse>;
  reviewSnapshot(
    reviewer: Reviewer,
    snapshotId: string,
    decision: ReviewDecision,
  ): Promise<ReviewSnapshotResponse>;
  approveAll(reviewer: Reviewer, buildId: string): Promise<ApproveAllResponse>;
  uploadImage(project: Project, hash: string, bytes: Uint8Array): Promise<UploadImageResponse>;
  getImage(principal: Principal, hash: string): Promise<Uint8Array>;
}

export function bindServices(deps: ServiceDeps): Services {
  return {
    getHealth: () => getHealth(deps.config),
    authenticateAdmin: (token) => authenticateAdmin(deps, token),
    authenticateProjectToken: (token) => authenticateProjectToken(deps, token),
    authenticateSession: (sessionId) => authenticateSession(deps, sessionId),
    assertSameOrigin: (request) => {
      assertSameOrigin(deps, request);
    },
    cookieSettings: () => cookieSettings(deps),
    beginLogin: (returnTo) => beginLogin(deps, returnTo),
    completeLogin: (callback) => completeLogin(deps, callback),
    logout: (sessionId) => logout(deps, sessionId),
    createProject: (request) => createProject(deps, request),
    listProjects: (reviewer) => listProjects(deps, reviewer),
    listBuilds: (reviewer, projectId, query) => listBuilds(deps, reviewer, projectId, query),
    getLibrary: (reviewer, projectId) => getLibrary(deps, reviewer, projectId),
    createBuild: (project, request) => createBuild(deps, project, request),
    getBuild: (principal, buildId) => getBuild(deps, principal, buildId),
    listSnapshots: (principal, buildId) => listSnapshots(deps, principal, buildId),
    submitResults: (project, buildId, request) => submitResults(deps, project, buildId, request),
    reviewSnapshot: (reviewer, snapshotId, decision) =>
      reviewSnapshot(deps, reviewer, snapshotId, decision),
    approveAll: (reviewer, buildId) => approveAll(deps, reviewer, buildId),
    uploadImage: (project, hash, bytes) => uploadImage(deps, project, hash, bytes),
    getImage: (principal, hash) => getImage(deps, principal, hash),
  };
}

export type { Project } from '../repositories/project.repository.ts';
export type { CookieSettings } from './login.service.ts';
export { sessionLifetimeSeconds } from './login.service.ts';
export type { Principal, Reviewer } from './principal.ts';
