import type {
  CreateBuildRequest,
  CreateBuildResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  GetBuildResponse,
  ListSnapshotsResponse,
  SubmitResultsRequest,
  SubmitResultsResponse,
  UploadImageResponse,
} from '@targus/core';

import type { Project } from '../repositories/project.repository.js';
import { authenticateAdmin, authenticateProjectToken } from './auth.service.js';
import { createBuild, getBuild, listSnapshots } from './build.service.js';
import type { ServiceDeps } from './deps.js';
import { getImage, uploadImage } from './image.service.js';
import { createProject } from './project.service.js';
import { submitResults } from './results.service.js';

/** The use-cases with their dependencies bound: what routes and middleware call. */
export interface Services {
  authenticateAdmin(token: string | null): Promise<void>;
  authenticateProjectToken(token: string | null): Promise<Project>;
  createProject(request: CreateProjectRequest): Promise<CreateProjectResponse>;
  createBuild(project: Project, request: CreateBuildRequest): Promise<CreateBuildResponse>;
  getBuild(project: Project, buildId: string): Promise<GetBuildResponse>;
  listSnapshots(project: Project, buildId: string): Promise<ListSnapshotsResponse>;
  submitResults(
    project: Project,
    buildId: string,
    request: SubmitResultsRequest,
  ): Promise<SubmitResultsResponse>;
  uploadImage(hash: string, bytes: Uint8Array): Promise<UploadImageResponse>;
  getImage(hash: string): Promise<Uint8Array>;
}

export function bindServices(deps: ServiceDeps): Services {
  return {
    authenticateAdmin: (token) => authenticateAdmin(deps, token),
    authenticateProjectToken: (token) => authenticateProjectToken(deps, token),
    createProject: (request) => createProject(deps, request),
    createBuild: (project, request) => createBuild(deps, project, request),
    getBuild: (project, buildId) => getBuild(deps, project, buildId),
    listSnapshots: (project, buildId) => listSnapshots(deps, project, buildId),
    submitResults: (project, buildId, request) => submitResults(deps, project, buildId, request),
    uploadImage: (hash, bytes) => uploadImage(deps, hash, bytes),
    getImage: (hash) => getImage(deps, hash),
  };
}

export type { Project } from '../repositories/project.repository.js';
