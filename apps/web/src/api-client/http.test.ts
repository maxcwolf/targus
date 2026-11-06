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

describe('ApiRequestError.requestId', () => {
  const body = (requestId?: string) => ({
    error: { code: 'internal', message: 'boom', ...(requestId ? { requestId } : {}) },
  });

  it('takes the id from the body before the header', () => {
    expect(new ApiRequestError(500, '/api/x', body('req-body'), 'req-header').requestId).toBe(
      'req-body',
    );
  });

  it('falls back to the header for a body without one', () => {
    expect(new ApiRequestError(500, '/api/x', body(), 'req-header').requestId).toBe('req-header');
    expect(new ApiRequestError(502, '/api/x', '<html>', 'req-header').requestId).toBe('req-header');
    expect(new SignedOutError('/api/me', null, 'GET', 'req-header').requestId).toBe('req-header');
  });

  it('is null when neither carries one', () => {
    expect(new ApiRequestError(500, '/api/x', body()).requestId).toBeNull();
    expect(new ApiRequestError(500, '/api/x', body(), '').requestId).toBeNull();
  });
});
