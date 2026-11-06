import type {
  ApproveAllResponse,
  CreateBuildRequest,
  CreateBuildResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  GetBuildResponse,
  GetLibraryResponse,
  ListBuildsResponse,
  ListProjectsResponse,
  ListSnapshotsResponse,
  ReviewDecision,
  ReviewSnapshotResponse,
  SubmitResultsRequest,
  SubmitResultsResponse,
  UploadImageResponse,
} from '@targus/core';

import type { Project } from '../repositories/project.repository.js';
import {
  authenticateAdmin,
  authenticateProjectToken,
  authenticateSession,
} from './auth.service.js';
import { createBuild, getBuild, listBuilds, listSnapshots } from './build.service.js';
import type { ServiceDeps } from './deps.js';
import { getImage, uploadImage } from './image.service.js';
import { getLibrary } from './library.service.js';
import {
  beginLogin,
  completeLogin,
  cookieSettings,
  logout,
  type CookieSettings,
  type LoginCallback,
  type LoginRedirect,
  type NewLogin,
} from './login.service.js';
import type { Principal, Reviewer } from './principal.js';
import { createProject, listProjects } from './project.service.js';
import { submitResults } from './results.service.js';
import { approveAll, reviewSnapshot } from './review.service.js';

/** The use-cases with their dependencies bound: what routes and middleware call. */
export interface Services {
  authenticateAdmin(token: string | null): Promise<void>;
  authenticateProjectToken(token: string | null): Promise<Project>;
  authenticateSession(sessionId: string | null): Promise<Reviewer>;
  /** How to sign cookies; null when `SESSION_SECRET` is not set. */
  cookieSettings(): CookieSettings | null;
  beginLogin(returnTo: string | undefined): LoginRedirect;
  completeLogin(callback: LoginCallback): Promise<NewLogin>;
  logout(sessionId: string): Promise<void>;
  createProject(request: CreateProjectRequest): Promise<CreateProjectResponse>;
  listProjects(reviewer: Reviewer): Promise<ListProjectsResponse>;
  listBuilds(reviewer: Reviewer, projectId: string, limit?: number): Promise<ListBuildsResponse>;
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
  uploadImage(hash: string, bytes: Uint8Array): Promise<UploadImageResponse>;
  getImage(principal: Principal, hash: string): Promise<Uint8Array>;
}

export function bindServices(deps: ServiceDeps): Services {
  return {
    authenticateAdmin: (token) => authenticateAdmin(deps, token),
    authenticateProjectToken: (token) => authenticateProjectToken(deps, token),
    authenticateSession: (sessionId) => authenticateSession(deps, sessionId),
    cookieSettings: () => cookieSettings(deps),
    beginLogin: (returnTo) => beginLogin(deps, returnTo),
    completeLogin: (callback) => completeLogin(deps, callback),
    logout: (sessionId) => logout(deps, sessionId),
    createProject: (request) => createProject(deps, request),
    listProjects: (reviewer) => listProjects(deps, reviewer),
    listBuilds: (reviewer, projectId, limit) => listBuilds(deps, reviewer, projectId, limit),
    getLibrary: (reviewer, projectId) => getLibrary(deps, reviewer, projectId),
    createBuild: (project, request) => createBuild(deps, project, request),
    getBuild: (principal, buildId) => getBuild(deps, principal, buildId),
    listSnapshots: (principal, buildId) => listSnapshots(deps, principal, buildId),
    submitResults: (project, buildId, request) => submitResults(deps, project, buildId, request),
    reviewSnapshot: (reviewer, snapshotId, decision) =>
      reviewSnapshot(deps, reviewer, snapshotId, decision),
    approveAll: (reviewer, buildId) => approveAll(deps, reviewer, buildId),
    uploadImage: (hash, bytes) => uploadImage(deps, hash, bytes),
    getImage: (principal, hash) => getImage(deps, principal, hash),
  };
}

export type { Project } from '../repositories/project.repository.js';
export type { CookieSettings } from './login.service.js';
export { sessionLifetimeSeconds } from './login.service.js';
export type { Principal, Reviewer } from './principal.js';
