import {
  ApproveAllResponse,
  GetBuildResponse,
  ListSnapshotsResponse,
  type ReviewDecision,
  type ReviewSnapshotsRequest,
  ReviewSnapshotsResponse,
} from '@targus/core/browser';

import { getJson, postJson } from './http.ts';

function buildPath(buildId: string): string {
  return `/api/builds/${encodeURIComponent(buildId)}`;
}

/** `GET /api/builds/:id`: the build with its status summary and counts. */
export function getBuild(buildId: string): Promise<GetBuildResponse> {
  return getJson(buildPath(buildId), GetBuildResponse);
}

/** `GET /api/builds/:id/snapshots`, sorted by story id. */
export function listSnapshots(buildId: string): Promise<ListSnapshotsResponse> {
  return getJson(`${buildPath(buildId)}/snapshots`, ListSnapshotsResponse);
}

/** `POST /api/builds/:id/approve-all`: approves every pending change in the build. */
export function approveAll(buildId: string): Promise<ApproveAllResponse> {
  return postJson(`${buildPath(buildId)}/approve-all`, ApproveAllResponse);
}

/** `POST /api/builds/:id/review`: one decision on several snapshots of the build. */
export function reviewSnapshots(
  buildId: string,
  decision: ReviewDecision,
  snapshotIds: readonly string[],
): Promise<ReviewSnapshotsResponse> {
  const body: ReviewSnapshotsRequest = { decision, snapshotIds: [...snapshotIds] };
  return postJson(`${buildPath(buildId)}/review`, ReviewSnapshotsResponse, body);
}
