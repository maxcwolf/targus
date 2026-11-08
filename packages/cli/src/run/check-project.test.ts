import { TargusError } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { checkProject } from './check-project.ts';
import { createFakeTargusApi } from './targus-api.fake.ts';

const url = 'https://targus.test';

describe('checkProject', () => {
  it("logs the token's project", async () => {
    const lines: string[] = [];

    await checkProject(createFakeTargusApi(), url, (line) => lines.push(line));

    expect(lines).toEqual(['project: example-app (example-org/example-app)']);
  });

  it('rewords a rejected token without a request id when the error has none', async () => {
    const api = createFakeTargusApi({
      currentProjectError: new TargusError('unauthorized', 'invalid project token'),
    });

    await expect(checkProject(api, url, () => undefined)).rejects.toMatchObject({
      code: 'unauthorized',
      requestId: null,
      message: expect.stringMatching(
        /^the targus API at https:\/\/targus\.test rejected TARGUS_TOKEN: .*rejected\)$/,
      ) as unknown,
    });
  });

  it('throws any other failure as it came', async () => {
    for (const error of [new TargusError('internal', 'cannot reach'), new Error('boom')]) {
      const api = createFakeTargusApi({ currentProjectError: error });
      await expect(checkProject(api, url, () => undefined)).rejects.toBe(error);
    }
  });
});
