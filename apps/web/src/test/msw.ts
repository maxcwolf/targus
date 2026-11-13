import {
  type Build,
  buildStatus,
  defaultFeatureFlags,
  type FeatureFlags,
  type BuildWithSummary,
  type GetLibraryResponse,
  needsReview,
  ReviewRequest,
  type Snapshot,
  tallySnapshots,
} from '@targus/core/browser';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import {
  initialLibrary,
  initialSnapshots,
  mainBuild,
  prBuild,
  project,
  reviewer,
} from './fixtures.ts';

/** An in-memory API: handlers read and write it, `resetApiState` runs after every test. */
interface ApiState {
  signedIn: boolean;
  builds: Build[];
  snapshots: Snapshot[];
  library: GetLibraryResponse;
  /** What `?platform=` answers, by platform; a platform not listed gets `library`. */
  libraryByPlatform: Partial<Record<string, GetLibraryResponse>>;
  /** What `GET /api/me` says is on; the defaults unless a test changes it. */
  features: FeatureFlags;
  /** `METHOD /path` of every mutating request, for assertions. */
  calls: string[];
  /** Snapshots another reviewer denies while an approve-all runs, so it skips them. */
  deniedDuringApproveAll: string[];
}

export const apiState: ApiState = {
  signedIn: true,
  features: defaultFeatureFlags(),
  builds: [],
  snapshots: [],
  library: initialLibrary(),
  libraryByPlatform: {},
  calls: [],
  deniedDuringApproveAll: [],
};

export function resetApiState(): void {
  apiState.signedIn = true;
  apiState.features = defaultFeatureFlags();
  apiState.builds = [prBuild, mainBuild];
  apiState.snapshots = initialSnapshots();
  apiState.library = initialLibrary();
  apiState.libraryByPlatform = {};
  apiState.calls = [];
  apiState.deniedDuringApproveAll = [];
}
resetApiState();

interface ErrorBody {
  error: { code: string; message: string; requestId?: string };
}

/** An API error body; pass `requestId` to answer as the real API does (ADR 0020). */
export function apiError(
  status: number,
  code: string,
  message: string,
  requestId?: string,
): HttpResponse<ErrorBody> {
  const error = requestId === undefined ? { code, message } : { code, message, requestId };
  return HttpResponse.json({ error }, { status });
}

function withSummary(build: Build): BuildWithSummary {
  const own = apiState.snapshots.filter((s) => s.buildId === build.id);
  const result = buildStatus(own);
  return {
    build: { ...build, status: result.status },
    summary: { ...result },
    counts: tallySnapshots(own).counts,
  };
}

function findBuild(id: unknown): Build | undefined {
  return apiState.builds.find((build) => build.id === id);
}

const reviewedAt = '2026-11-03T12:00:00Z';

function decide(snapshot: Snapshot, review: 'approved' | 'denied'): Snapshot {
  const updated = { ...snapshot, review, reviewedBy: reviewer.login, reviewedAt };
  apiState.snapshots = apiState.snapshots.map((s) => (s.id === snapshot.id ? updated : s));
  return updated;
}

const notFound = (): HttpResponse<ErrorBody> => apiError(404, 'not_found', 'Build not found');

export const handlers = [
  http.get('*/api/me', () =>
    apiState.signedIn
      ? HttpResponse.json({ user: reviewer, features: apiState.features })
      : apiError(401, 'unauthorized', 'Sign in first'),
  ),
  http.post('*/api/auth/logout', () => {
    apiState.calls.push('POST /api/auth/logout');
    apiState.signedIn = false;
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('*/api/projects', () => HttpResponse.json({ projects: [project] })),
  http.get('*/api/projects/:projectId/builds', ({ params }) => {
    if (params.projectId !== project.id) return apiError(404, 'not_found', 'No project');
    return HttpResponse.json({ builds: apiState.builds.map(withSummary) });
  }),
  http.get('*/api/projects/:projectId/library', ({ params, request }) => {
    if (params.projectId !== project.id) return apiError(404, 'not_found', 'No project');
    const platform = new URL(request.url).searchParams.get('platform');
    return HttpResponse.json(
      (platform === null ? undefined : apiState.libraryByPlatform[platform]) ?? apiState.library,
    );
  }),
  http.get('*/api/builds/:buildId', ({ params }) => {
    const build = findBuild(params.buildId);
    return build ? HttpResponse.json(withSummary(build)) : notFound();
  }),
  http.get('*/api/builds/:buildId/snapshots', ({ params }) => {
    const build = findBuild(params.buildId);
    if (!build) return notFound();
    return HttpResponse.json({
      snapshots: apiState.snapshots.filter((s) => s.buildId === build.id),
    });
  }),
  http.post('*/api/snapshots/:snapshotId/review', async ({ params, request }) => {
    apiState.calls.push(`POST /api/snapshots/${String(params.snapshotId)}/review`);
    const { decision } = ReviewRequest.parse(await request.json());
    const snapshot = apiState.snapshots.find((s) => s.id === params.snapshotId);
    const build = findBuild(snapshot?.buildId);
    if (!snapshot || !build) return apiError(404, 'not_found', 'No snapshot');
    if (!needsReview(snapshot.state)) return apiError(409, 'conflict', 'Not reviewable');
    const updated = decide(snapshot, decision === 'approve' ? 'approved' : 'denied');
    return HttpResponse.json({ snapshot: updated, ...withSummary(build) });
  }),
  http.post('*/api/builds/:buildId/approve-all', ({ params }) => {
    apiState.calls.push(`POST /api/builds/${String(params.buildId)}/approve-all`);
    const build = findBuild(params.buildId);
    if (!build) return notFound();
    const pending = apiState.snapshots.filter(
      (s) => s.buildId === build.id && needsReview(s.state) && s.review === 'pending',
    );
    const denied = pending.filter((s) => apiState.deniedDuringApproveAll.includes(s.id));
    for (const snapshot of pending)
      decide(snapshot, denied.includes(snapshot) ? 'denied' : 'approved');
    const skippedCount = denied.length;
    const approvedCount = pending.length - skippedCount;
    return HttpResponse.json({ ...withSummary(build), approvedCount, skippedCount });
  }),
  http.get('*/api/images/:hash', () =>
    HttpResponse.arrayBuffer(new ArrayBuffer(0), { headers: { 'content-type': 'image/png' } }),
  ),
];

export const server = setupServer(...handlers);
