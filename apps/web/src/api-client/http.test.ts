import { describe, expect, it } from 'vitest';

import { ApiRequestError, isSignedOut, SignedOutError } from './http.ts';

describe('SignedOutError', () => {
  it('is the one 401 outcome, still an ApiRequestError, worded for reads and for writes', () => {
    const read = new SignedOutError('/api/me', null, 'GET');
    const write = new SignedOutError('/api/snapshots/s1/review', null, 'POST');

    expect(read).toBeInstanceOf(ApiRequestError);
    expect(read.status).toBe(401);
    expect(read.message).toMatch(/^Your session has expired/);
    expect(write.message).toMatch(/^Not saved: /);
    expect(isSignedOut(write)).toBe(true);
    expect(isSignedOut(new ApiRequestError(403, '/api/projects', null))).toBe(false);
  });
});
