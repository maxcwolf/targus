import {
  defaultThreshold,
  SubmitResultsRequest,
  TargusError,
  type CreateBuildRequest,
  type CreateBuildResponse,
  type CurrentProjectResponse,
  type SubmitResultsResponse,
} from '@targus/core';

import { sha256Hex } from '../capture/png.ts';
import type { TargusApi } from './targus-api.ts';

export type FakeApiCall =
  | { readonly method: 'currentProject' }
  | { readonly method: 'createBuild'; readonly request: CreateBuildRequest }
  | { readonly method: 'uploadImage'; readonly hash: string }
  | { readonly method: 'getImage'; readonly hash: string }
  | {
      readonly method: 'submitResults';
      readonly buildId: string;
      readonly request: SubmitResultsRequest;
    };

export interface FakeTargusApi extends TargusApi {
  readonly calls: FakeApiCall[];
  /** Every image the fake server holds, by hash. */
  readonly images: Map<string, Uint8Array>;
  /** Calls of one method, in order. */
  callsOf<M extends FakeApiCall['method']>(method: M): Extract<FakeApiCall, { method: M }>[];
}

export interface FakeTargusApiOptions {
  /** Accepted baseline PNG per story id; the fake stores them and serves them from `getImage`. */
  readonly baselines?: Readonly<Record<string, Uint8Array>>;
  /** Extra images the server already has. */
  readonly stored?: readonly Uint8Array[];
  readonly checkRunId?: number | null;
  /** What `currentProject` rejects with, as the server would for a bad token; resolves if unset. */
  readonly currentProjectError?: Error;
  /** The diff threshold the fake server returns with a new build. Default: core's default. */
  readonly threshold?: number;
}

/** The project the fake answers `currentProject` with. */
export const fakeProject: CurrentProjectResponse['project'] = {
  id: 'project-1',
  orgId: 'org-1',
  githubOrg: 'example-org',
  repo: 'example-org/example-app',
  name: 'the pilot app',
  defaultBranch: 'main',
};

function submitResponse(
  buildId: string,
  request: SubmitResultsRequest,
  checkRunId: number | null,
): SubmitResultsResponse {
  const pendingCount = request.results.filter((r) => r.state === 'changed' || r.state === 'new');
  const errorCount = request.results.filter((r) => r.state === 'error').length;
  const pending = pendingCount.length;
  return {
    build: { id: buildId, number: 1 },
    summary: {
      status: errorCount > 0 ? 'failed' : pending > 0 ? 'pending' : 'passed',
      conclusion: errorCount > 0 ? 'failure' : pending > 0 ? null : 'success',
      pendingCount: pending,
      deniedCount: 0,
      errorCount,
    },
    reviewUrl: `https://targus.test/builds/${buildId}`,
    checkRun: checkRunId === null ? null : { id: checkRunId },
    checkRunMissing: checkRunId === null ? 'no_installation' : null,
  };
}

/** `currentProject`: `fakeProject`, or a rejection with `error` as for a bad token. */
function currentProject(error: Error | undefined): Promise<CurrentProjectResponse> {
  return error === undefined ? Promise.resolve({ project: fakeProject }) : Promise.reject(error);
}

/**
 * An in-memory targus API: it serves the given baselines, reports every snapshot hash it does
 * not hold as missing, stores uploads, checks submitted results against the contract, and
 * records every call.
 */
export function createFakeTargusApi(options: FakeTargusApiOptions = {}): FakeTargusApi {
  const calls: FakeApiCall[] = [];
  const images = new Map<string, Uint8Array>();
  const baselines = Object.entries(options.baselines ?? {}).map(([storyId, png]) => {
    const imageHash = sha256Hex(png);
    images.set(imageHash, png);
    return { storyId, variant: 'default', imageHash };
  });
  for (const png of options.stored ?? []) images.set(sha256Hex(png), png);
  const checkRunId = options.checkRunId === undefined ? 1 : options.checkRunId;

  return {
    calls,
    images,
    callsOf: <M extends FakeApiCall['method']>(method: M) =>
      calls.filter((call): call is Extract<FakeApiCall, { method: M }> => call.method === method),
    currentProject: () => {
      calls.push({ method: 'currentProject' });
      return currentProject(options.currentProjectError);
    },
    createBuild: (request): Promise<CreateBuildResponse> => {
      calls.push({ method: 'createBuild', request });
      const hashes = new Set(request.snapshots.map((snapshot) => snapshot.imageHash));
      return Promise.resolve({
        build: { id: 'build-1', number: 1 },
        baselineBuildId: baselines.length > 0 ? 'build-0' : null,
        baselines,
        missingImageHashes: [...hashes].filter((hash) => !images.has(hash)),
        threshold: options.threshold ?? defaultThreshold,
      });
    },
    uploadImage: (hash, png) => {
      calls.push({ method: 'uploadImage', hash });
      const stored = !images.has(hash);
      images.set(hash, png);
      return Promise.resolve({ hash, stored });
    },
    getImage: (hash) => {
      calls.push({ method: 'getImage', hash });
      const png = images.get(hash);
      if (png === undefined)
        return Promise.reject(new TargusError('not_found', `no image ${hash}`));
      return Promise.resolve(png);
    },
    submitResults: (buildId, request) => {
      calls.push({ method: 'submitResults', buildId, request });
      // The real server validates the body against the contract, so the fake does too.
      SubmitResultsRequest.parse(request);
      return Promise.resolve(submitResponse(buildId, request, checkRunId));
    },
  };
}
