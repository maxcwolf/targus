import { type ReviewDecision, type ReviewRequest, ReviewSnapshotResponse } from '@targus/core';

import { postJson } from './http.js';

/** `POST /api/snapshots/:id/review`: approve or deny one snapshot. */
export function reviewSnapshot(
  snapshotId: string,
  decision: ReviewDecision,
): Promise<ReviewSnapshotResponse> {
  const body: ReviewRequest = { decision };
  return postJson(
    `/api/snapshots/${encodeURIComponent(snapshotId)}/review`,
    ReviewSnapshotResponse,
    body,
  );
}
