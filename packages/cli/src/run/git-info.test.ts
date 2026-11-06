import { isTargusError, TargusError } from '@targus/core';
import { describe, expect, it } from 'vitest';

import type { GitMetadata } from '../adapters/git.adapter.ts';
import { readGitInfo, shallowCloneHelp } from './git-info.ts';

const head = 'a'.repeat(40);
const mergeBase = 'b'.repeat(40);
const ancestor = 'c'.repeat(40);

/** A checkout where `refs` exist, `origin/main` and `main` by default; records every call. */
function fakeGit(
  overrides: Partial<GitMetadata> = {},
  refs: readonly string[] = ['origin/main', 'main'],
): GitMetadata & { calls: string[] } {
  const calls: string[] = [];
  const record = <T>(call: string, value: T): Promise<T> => {
    calls.push(call);
    return Promise.resolve(value);
  };
  return {
    calls,
    headSha: () => record('headSha', head),
    currentBranch: () => record('currentBranch', 'feature/button'),
    isShallow: () => record('isShallow', false),
    fetchBase: (branch) => record(`fetchBase ${branch}`, undefined),
    resolveCommit: (ref) => record(`resolveCommit ${ref}`, refs.includes(ref) ? mergeBase : null),
    mergeBase: (ref) => record(`mergeBase ${ref}`, mergeBase),
    firstParentAncestors: (sha, limit) => record(`ancestors ${sha} ${limit}`, [ancestor]),
    ...overrides,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (isTargusError(error)) return `${error.code}: ${error.message}`;
    throw error;
  }
  return 'resolved';
}

describe('readGitInfo', () => {
  it('fetches the base, then takes the merge base with origin/<base> and its ancestors', async () => {
    const git = fakeGit();

    expect(await readGitInfo(git, 'main')).toEqual({
      sha: head,
      mergeBaseSha: mergeBase,
      ancestors: [ancestor],
    });
    expect(git.calls).toEqual([
      'headSha',
      'isShallow',
      'fetchBase main',
      'resolveCommit origin/main',
      'mergeBase origin/main',
      `ancestors ${mergeBase} 100`,
    ]);
  });

  it('uses --sha instead of HEAD, keeping the merge base of HEAD', async () => {
    const override = 'd'.repeat(40);
    const git = fakeGit({ headSha: () => Promise.reject(new Error('HEAD must not be read')) });

    expect(await readGitInfo(git, 'main', override)).toEqual({
      sha: override,
      mergeBaseSha: mergeBase,
      ancestors: [ancestor],
    });
  });

  it('explains a missing git checkout', async () => {
    const git = fakeGit({ headSha: () => Promise.reject(new Error('not a git repository')) });

    expect(await codeOf(readGitInfo(git, 'main'))).toMatch(/^bad_request: cannot read git HEAD/);
  });

  it('refuses a shallow clone before fetching, and says how to fix it', async () => {
    const git = fakeGit({ isShallow: () => Promise.resolve(true) });

    expect(await codeOf(readGitInfo(git, 'main'))).toBe(`bad_request: ${shallowCloneHelp}`);
    expect(shallowCloneHelp).toContain('fetch-depth: 0');
    expect(git.calls).toEqual(['headSha']);
  });
});

describe('readGitInfo base branch', () => {
  it('sends no ancestors when git finds no shared history', async () => {
    const git = fakeGit({ mergeBase: () => Promise.resolve(null) });

    expect(await readGitInfo(git, 'main')).toEqual({
      sha: head,
      mergeBaseSha: null,
      ancestors: [],
    });
  });

  it('falls back to the local base branch when origin has none', async () => {
    const git = fakeGit({}, ['develop']);

    expect((await readGitInfo(git, 'develop')).mergeBaseSha).toBe(mergeBase);
    expect(git.calls).toContain('mergeBase develop');
  });

  it('warns and goes on when the fetch fails but the base exists locally', async () => {
    const warnings: string[] = [];
    const git = fakeGit({ fetchBase: () => Promise.reject(new Error('could not resolve host')) });

    expect((await readGitInfo(git, 'main', undefined, warnings.push.bind(warnings))).sha).toBe(
      head,
    );
    expect(warnings).toEqual([
      'warning: could not fetch main from origin; using origin/main, which may be stale',
    ]);
  });
});

describe('readGitInfo failures', () => {
  it('fails with the fetch error when the base exists nowhere', async () => {
    const fetchError = new TargusError('bad_request', 'git fetch failed: could not resolve host');
    const git = fakeGit({ fetchBase: () => Promise.reject(fetchError) }, []);

    const error: unknown = await readGitInfo(git, 'main').catch((caught: unknown) => caught);

    expect(isTargusError(error) && error.message).toBe(
      'cannot find the base branch main: fetching it from origin failed and there is no local main; pass --base-branch',
    );
    expect(error instanceof Error && error.cause).toBe(fetchError);
  });

  it('fails when the fetch succeeds but no base ref resolves', async () => {
    expect(await codeOf(readGitInfo(fakeGit({}, []), 'trunk'))).toMatch(
      /^bad_request: cannot find the base branch trunk: origin has no such branch/,
    );
  });

  it('lets a git failure in merge-base or rev-list through', async () => {
    const broken = new TargusError('bad_request', 'git merge-base failed: fatal: bad object');

    expect(
      await codeOf(readGitInfo(fakeGit({ mergeBase: () => Promise.reject(broken) }), 'main')),
    ).toBe(`bad_request: ${broken.message}`);
    const ancestorsFail = fakeGit({ firstParentAncestors: () => Promise.reject(broken) });
    expect(await codeOf(readGitInfo(ancestorsFail, 'main'))).toBe(`bad_request: ${broken.message}`);
  });
});
