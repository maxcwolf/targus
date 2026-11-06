import { TargusError } from '@targus/core';

import type { GitMetadata } from '../adapters/git.adapter.js';
import { maxAncestors, type RunGitInfo } from './run-build.js';

/** Shown when the checkout is shallow; exported so tests and docs can match it. */
export const shallowCloneHelp = [
  'this checkout is a shallow clone, so targus cannot find the merge base with the base branch',
  'or its ancestors, and every story would be reported as new. Fetch the full history: on GitHub',
  'Actions set `fetch-depth: 0` on actions/checkout (`with: { fetch-depth: 0 }`); elsewhere run',
  '`git fetch --unshallow`.',
].join(' ');

async function readHeadSha(git: GitMetadata): Promise<string> {
  return git.headSha().catch((error: unknown) => {
    throw new TargusError('bad_request', 'cannot read git HEAD: run targus run in a git checkout', {
      cause: error,
    });
  });
}

/**
 * A shallow clone's history stops at its boundary commits, and git reports that the same way it
 * reports unrelated histories: no merge base, or an ancestor list cut short. Refuse it.
 */
async function requireFullHistory(git: GitMetadata): Promise<void> {
  if (await git.isShallow()) throw new TargusError('bad_request', shallowCloneHelp);
}

/**
 * The ref to take the merge base against: `origin/<base>` after fetching it, else the local
 * branch. A failed fetch is harmless when one of them already exists (a local checkout with no
 * network or no `origin`), so it is reported with `warn` and the run goes on; with neither, the
 * fetch failure is the error.
 */
async function baseRef(
  git: GitMetadata,
  baseBranch: string,
  warn: (line: string) => void,
): Promise<string> {
  const fetchError = await git.fetchBase(baseBranch).then(
    () => null,
    (error: unknown) => error,
  );
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    if ((await git.resolveCommit(ref)) === null) continue;
    if (fetchError !== null) {
      warn(`warning: could not fetch ${baseBranch} from origin; using ${ref}, which may be stale`);
    }
    return ref;
  }
  const why = fetchError === null ? 'origin has no such branch' : 'fetching it from origin failed';
  throw new TargusError(
    'bad_request',
    `cannot find the base branch ${baseBranch}: ${why} and there is no local ${baseBranch}; pass --base-branch`,
    { cause: fetchError ?? undefined },
  );
}

/**
 * sha, merge base with the base branch and its first-parent ancestors (ADR 0004). `sha`
 * (from `--sha`) replaces `HEAD` as the build's commit; the merge base is still that of `HEAD`.
 * `null` merge base means git found no shared history, never that git failed.
 */
export async function readGitInfo(
  git: GitMetadata,
  baseBranch: string,
  sha?: string,
  warn: (line: string) => void = () => undefined,
): Promise<RunGitInfo> {
  const buildSha = sha ?? (await readHeadSha(git));
  await requireFullHistory(git);
  const mergeBaseSha = await git.mergeBase(await baseRef(git, baseBranch, warn));
  const ancestors =
    mergeBaseSha === null ? [] : await git.firstParentAncestors(mergeBaseSha, maxAncestors);
  return { sha: buildSha, mergeBaseSha, ancestors };
}
