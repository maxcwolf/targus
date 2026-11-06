import { ReviewSnapshotResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { bearer, call, postJson } from '../../test/support/api.ts';
import { storyResult } from '../../test/support/fixtures.ts';
import { postAsReviewer, projectWithBuild } from '../../test/support/review.ts';
import { signIn } from '../../test/support/session.ts';

describe('POST /api/snapshots/:id/review', () => {
  it('approves a snapshot for a member, matching the contract', async () => {
    const { snapshots } = await projectWithBuild([storyResult('button')]);
    const { cookie } = await signIn('octocat');
    const [snapshot] = snapshots;

    const response = await postAsReviewer(`/api/snapshots/${snapshot?.id ?? ''}/review`, cookie, {
      decision: 'approve',
    });

    expect(response.status).toBe(200);
    const body = ReviewSnapshotResponse.parse(await response.json());
    expect(body.snapshot).toMatchObject({ review: 'approved', reviewedBy: 'octocat' });
    expect(body.summary.status).toBe('accepted');
  });

  it('answers 400 for a bad body, 403 outside the org, 404 for unknown and 401 without a session', async () => {
    const { token, snapshots } = await projectWithBuild([storyResult('button')]);
    const member = await signIn('octocat');
    const outsider = await signIn('outsider');
    const path = `/api/snapshots/${snapshots[0]?.id ?? ''}/review`;

    expect((await postAsReviewer(path, member.cookie, { decision: 'maybe' })).status).toBe(400);
    expect((await postAsReviewer(path, outsider.cookie, { decision: 'deny' })).status).toBe(403);
    expect(
      (await postAsReviewer('/api/snapshots/nope/review', member.cookie, { decision: 'deny' }))
        .status,
    ).toBe(404);
    expect((await postJson(path, token, { decision: 'deny' })).status).toBe(401);
    expect((await call(path, { method: 'POST', headers: bearer(token) })).status).toBe(401);
  });

  it('answers 409 for a snapshot that needs no review', async () => {
    const { snapshots } = await projectWithBuild([
      storyResult('broken', {
        state: 'error',
        imageHash: null,
        width: null,
        height: null,
        error: 'x',
      }),
    ]);
    const { cookie } = await signIn('octocat');

    const response = await postAsReviewer(
      `/api/snapshots/${snapshots[0]?.id ?? ''}/review`,
      cookie,
      {
        decision: 'approve',
      },
    );

    expect(response.status).toBe(409);
  });
});
