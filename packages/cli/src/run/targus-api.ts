import type {
  CreateBuildRequest,
  CreateBuildResponse,
  CurrentProjectResponse,
  SubmitResultsRequest,
  SubmitResultsResponse,
  UploadImageResponse,
} from '@targus/core';

/**
 * The targus API calls `targus run` makes (plan.md section 5.2), authenticated by the project
 * token. `TargusApiClient` implements it over HTTP; `createFakeTargusApi` in memory.
 */
export interface TargusApi {
  /** The token's project; a 401 means the token is wrong or revoked. Asked before capturing. */
  currentProject(): Promise<CurrentProjectResponse>;
  createBuild(request: CreateBuildRequest): Promise<CreateBuildResponse>;
  uploadImage(hash: string, png: Uint8Array): Promise<UploadImageResponse>;
  getImage(hash: string): Promise<Uint8Array>;
  submitResults(buildId: string, request: SubmitResultsRequest): Promise<SubmitResultsResponse>;
}
