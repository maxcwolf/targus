import { describe, expect, it } from 'vitest';

import { buildStatus, type SnapshotOutcome } from './build-status.js';

const unchanged: SnapshotOutcome = { state: 'unchanged', review: 'pending' };
const changedPending: SnapshotOutcome = { state: 'changed', review: 'pending' };
const changedApproved: SnapshotOutcome = { state: 'changed', review: 'approved' };
const changedDenied: SnapshotOutcome = { state: 'changed', review: 'denied' };
const newPending: SnapshotOutcome = { state: 'new', review: 'pending' };
const newApproved: SnapshotOutcome = { state: 'new', review: 'approved' };
const removed: SnapshotOutcome = { state: 'removed', review: 'pending' };
const unstable: SnapshotOutcome = { state: 'unstable', review: 'pending' };
const errored: SnapshotOutcome = { state: 'error', review: 'pending' };

describe('buildStatus', () => {
  it('passes an empty build', () => {
    expect(buildStatus([])).toEqual({
      status: 'passed',
      conclusion: 'success',
      pendingCount: 0,
      deniedCount: 0,
      errorCount: 0,
    });
  });

  it('passes when nothing needs review, ignoring removed and unstable snapshots', () => {
    expect(buildStatus([unchanged, removed, unstable])).toEqual({
      status: 'passed',
      conclusion: 'success',
      pendingCount: 0,
      deniedCount: 0,
      errorCount: 0,
    });
  });

  it('stays pending with an in-progress check while any change awaits review', () => {
    expect(buildStatus([unchanged, changedApproved, changedPending, newPending])).toEqual({
      status: 'pending',
      conclusion: null,
      pendingCount: 2,
      deniedCount: 0,
      errorCount: 0,
    });
  });

  it('is accepted once every change and new story is approved', () => {
    expect(buildStatus([unchanged, changedApproved, newApproved, unstable])).toEqual({
      status: 'accepted',
      conclusion: 'success',
      pendingCount: 0,
      deniedCount: 0,
      errorCount: 0,
    });
  });

  it('fails as soon as any change is denied, even with others pending', () => {
    expect(buildStatus([changedPending, changedDenied, newApproved])).toEqual({
      status: 'denied',
      conclusion: 'failure',
      pendingCount: 1,
      deniedCount: 1,
      errorCount: 0,
    });
  });
});

describe('buildStatus with errored stories', () => {
  it('fails a build with an errored story, which is not counted as awaiting review', () => {
    expect(buildStatus([unchanged, errored])).toEqual({
      status: 'failed',
      conclusion: 'failure',
      pendingCount: 0,
      deniedCount: 0,
      errorCount: 1,
    });
  });

  it('reports failed rather than denied or pending when errors and reviews mix', () => {
    expect(buildStatus([changedDenied, changedPending, errored, errored])).toEqual({
      status: 'failed',
      conclusion: 'failure',
      pendingCount: 1,
      deniedCount: 1,
      errorCount: 2,
    });
  });

  it('fails even when every other change is approved', () => {
    expect(buildStatus([changedApproved, newApproved, unstable, errored]).status).toBe('failed');
  });
});
