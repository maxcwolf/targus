import type {
  CreateBuildRequest,
  CreateBuildResponse,
  SubmitResultsRequest,
  SubmitResultsResponse,
  UploadImageResponse,
} from '@targus/core';

/**
 * The four targus API calls `targus run` makes (plan.md section 5.2), authenticated by the
 * project token. `TargusApiClient` implements it over HTTP; `createFakeTargusApi` in memory.
 */
export interface TargusApi {
  createBuild(request: CreateBuildRequest): Promise<CreateBuildResponse>;
  uploadImage(hash: string, png: Uint8Array): Promise<UploadImageResponse>;
  getImage(hash: string): Promise<Uint8Array>;
  submitResults(buildId: string, request: SubmitResultsRequest): Promise<SubmitResultsResponse>;
}
