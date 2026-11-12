import { ListSnapshotsResponse, ReviewSnapshotsResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { bearer, call, postJson } from '../../test/support/api.ts';
import { storyResult } from '../../test/support/fixtures.ts';
import { postAsReviewer, projectWithBuild } from '../../test/support/review.ts';
import { signIn } from '../../test/support/session.ts';

describe('POST /api/builds/:id/review', () => {
  it('decides several snapshots of the build at once', async () => {
    const { token, buildId, snapshots } = await projectWithBuild([
      storyResult('button'),
      storyResult('card'),
      storyResult('badge'),
    ]);
    const { cookie } = await signIn('octocat');
    const [first, second] = snapshots.map((snapshot) => snapshot.id);

    const response = await postAsReviewer(`/api/builds/${buildId}/review`, cookie, {
      decision: 'approve',
      snapshotIds: [first, second],
    });

    expect(response.status).toBe(200);
    const body = ReviewSnapshotsResponse.parse(await response.json());
    expect(body).toMatchObject({
      decidedCount: 2,
      summary: { status: 'pending', pendingCount: 1 },
    });
    const listed = await call(`/api/builds/${buildId}/snapshots`, { headers: bearer(token) });
    const after = ListSnapshotsResponse.parse(await listed.json()).snapshots;
    expect(after.map((snapshot) => snapshot.review)).toEqual(['approved', 'approved', 'pending']);
  });

  it('answers 400 for a bad body, 403 outside the org, 404 for unknown and 401 without a session', async () => {
    const { token, buildId, snapshots } = await projectWithBuild([storyResult('button')]);
    const member = await signIn('octocat');
    const outsider = await signIn('outsider');
    const path = `/api/builds/${buildId}/review`;
    const body = { decision: 'deny', snapshotIds: snapshots.map((snapshot) => snapshot.id) };
    const status = async (cookie: string, sent: unknown, to = path): Promise<number> =>
      (await postAsReviewer(to, cookie, sent)).status;

    expect(await status(member.cookie, { decision: 'deny', snapshotIds: [] })).toBe(400);
    expect(await status(member.cookie, { decision: 'maybe', snapshotIds: ['x'] })).toBe(400);
    expect(await status(member.cookie, { decision: 'deny' })).toBe(400);
    expect(await status(outsider.cookie, body)).toBe(403);
    expect(await status(member.cookie, { ...body, snapshotIds: ['nope'] })).toBe(404);
    expect(await status(member.cookie, body, '/api/builds/nope/review')).toBe(404);
    expect((await postJson(path, token, body)).status).toBe(401);
  });
});
