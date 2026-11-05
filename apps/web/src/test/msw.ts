import {
  type Build,
  buildStatus,
  type BuildWithSummary,
  needsReview,
  ReviewRequest,
  type Snapshot,
  tallySnapshots,
} from '@targus/core';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { initialSnapshots, mainBuild, prBuild, project, reviewer } from './fixtures.js';

/** An in-memory API: handlers read and write it, `resetApiState` runs after every test. */
interface ApiState {
  signedIn: boolean;
  builds: Build[];
  snapshots: Snapshot[];
  /** `METHOD /path` of every mutating request, for assertions. */
  calls: string[];
}

export const apiState: ApiState = { signedIn: true, builds: [], snapshots: [], calls: [] };

export function resetApiState(): void {
  apiState.signedIn = true;
  apiState.builds = [prBuild, mainBuild];
  apiState.snapshots = initialSnapshots();
  apiState.calls = [];
}
resetApiState();

interface ErrorBody {
  error: { code: string; message: string };
}

export function apiError(status: number, code: string, message: string): HttpResponse<ErrorBody> {
  return HttpResponse.json({ error: { code, message } }, { status });
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
      ? HttpResponse.json({ user: reviewer })
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
    for (const snapshot of pending) decide(snapshot, 'approved');
    return HttpResponse.json({ ...withSummary(build), approvedCount: pending.length });
  }),
  http.get('*/api/images/:hash', () =>
    HttpResponse.arrayBuffer(new ArrayBuffer(0), { headers: { 'content-type': 'image/png' } }),
  ),
];

export const server = setupServer(...handlers);
