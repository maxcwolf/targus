import { describe, expect, it } from 'vitest';

import { ApiRequestError } from '../api-client/index.js';
import { createQueryClient } from './query-client.js';

describe('createQueryClient', () => {
  it('retries transient failures but never 4xx answers', () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry;
    if (typeof retry !== 'function') throw new Error('expected a retry function');

    expect(retry(0, new ApiRequestError(401, '/api/me', null))).toBe(false);
    expect(retry(0, new ApiRequestError(503, '/api/me', null))).toBe(true);
    expect(retry(2, new Error('network'))).toBe(false);
  });
});
