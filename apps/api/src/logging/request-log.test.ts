import { TargusError } from '@targus/core';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';

import { describeError, failureReason, RequestLog } from './request-log.ts';

const startedAt = new Date('2026-01-01T00:00:00.000Z');
const outcome = {
  method: 'GET',
  route: '/api/projects',
  status: 200,
  cfRay: null,
  finishedAt: new Date('2026-01-01T00:00:00.040Z'),
  error: undefined,
};

describe('describeError', () => {
  it('logs only the code of a TargusError, whose message may name a user or an org', () => {
    expect(describeError(new TargusError('forbidden', 'you are not a member of acme'))).toEqual({
      code: 'forbidden',
    });
  });

  it('logs an HTTPException by its status and anything else as internal', () => {
    const bare = new Error('boom');
    delete bare.stack;

    expect(describeError(new HTTPException(413))).toEqual({ code: 'http_413' });
    expect(describeError(bare)).toEqual({ code: 'internal', message: 'boom' });
    expect(describeError('a string')).toEqual({
      code: 'internal',
      message: 'a non-Error string was thrown',
    });
    expect(describeError(undefined)).toBeUndefined();
  });
});

describe('failureReason', () => {
  it('names a GitHub error by its status and anything else by its message', () => {
    expect(failureReason(Object.assign(new Error('Bad credentials'), { status: 401 }))).toBe(
      'github 401',
    );
    expect(failureReason(new Error('D1 is unavailable'))).toBe('D1 is unavailable');
    expect(failureReason(42)).toBe('unknown error');
  });
});

describe('RequestLog', () => {
  it('carries the warnings of the request on its one line, at level warn', () => {
    const log = new RequestLog('req-1', startedAt);
    log.authenticatedAs('reviewer');
    log.warn('org_membership_unchecked', { orgs: ['acme'] });
    log.warn('plain');

    expect(log.entry(outcome)).toEqual({
      level: 'warn',
      event: 'request',
      requestId: 'req-1',
      cfRay: null,
      method: 'GET',
      route: '/api/projects',
      status: 200,
      durationMs: 40,
      principal: 'reviewer',
      warnings: [{ event: 'org_membership_unchecked', orgs: ['acme'] }, { event: 'plain' }],
    });
  });

  it('logs a 5xx at level error, warnings or not', () => {
    const log = new RequestLog('req-2', startedAt);
    log.warn('plain');

    expect(log.entry({ ...outcome, status: 503 }).level).toBe('error');
  });
});
