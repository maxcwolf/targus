import { GetStoryHistoryResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { call } from '../../test/support/api.ts';
import { storyResult } from '../../test/support/fixtures.ts';
import { getAsReviewer, projectWithBuild } from '../../test/support/review.ts';
import { signIn } from '../../test/support/session.ts';

describe('GET /api/projects/:id/history', () => {
  it('lists where a story changed, for members of its org only', async () => {
    const { project, buildId } = await projectWithBuild([storyResult('button')]);
    const member = await signIn('octocat');
    const outsider = await signIn('outsider');
    const history = `/api/projects/${project.id}/history?storyId=button&platform=ios`;

    const response = await getAsReviewer(history, member.cookie);

    expect(response.status).toBe(200);
    const { entries } = GetStoryHistoryResponse.parse(await response.json());
    expect(entries).toMatchObject([
      {
        build: { id: buildId, number: 1, platform: 'ios' },
        snapshot: { buildId, storyId: 'button', variant: 'default', state: 'new' },
      },
    ]);
    expect(entries[0]?.build).not.toHaveProperty('tally');
    expect(entries[0]?.snapshot).not.toHaveProperty('blank');

    const other = await getAsReviewer(`${history}&variant=ax5`, member.cookie);
    expect(GetStoryHistoryResponse.parse(await other.json()).entries).toEqual([]);
    expect((await getAsReviewer(history, outsider.cookie)).status).toBe(403);
    const missing = '/api/projects/nope/history?storyId=button&platform=ios';
    expect((await getAsReviewer(missing, member.cookie)).status).toBe(404);
    expect((await call(history)).status).toBe(401);
  });

  it('refuses a query without a story, with an unknown platform or a limit out of range', async () => {
    const { project } = await projectWithBuild([storyResult('button')]);
    const { cookie } = await signIn('octocat');
    const history = `/api/projects/${project.id}/history`;

    for (const query of [
      '?platform=ios',
      '?storyId=button',
      '?storyId=button&platform=macos',
      '?storyId=button&platform=ios&limit=0',
      '?storyId=button&platform=ios&limit=51',
    ]) {
      const response = await getAsReviewer(`${history}${query}`, cookie);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: {
          code: 'bad_request',
          message:
            'storyId is required; platform must be one of ios, android, web; limit an integer 1..50',
        },
      });
    }
  });
});
