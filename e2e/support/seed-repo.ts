import { mkdir, rm } from 'node:fs/promises';

import { git, type Checkout } from './cli.ts';

// A throwaway git repository for `yarn dev:local` to publish from, so seeding never depends on
// this checkout's git: it works from a shallow clone, without a `main` branch, or with no `.git`.
// git runs with cli.ts's scrubbed environment (no inherited GIT_DIR, no search above the
// directory) and ignores the user's and the system's git config, so no identity, signing or
// hooks setting applies.

const isolated: NodeJS.ProcessEnv = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'targus dev:local',
  GIT_AUTHOR_EMAIL: 'dev-local@targus.invalid',
  GIT_COMMITTER_NAME: 'targus dev:local',
  GIT_COMMITTER_EMAIL: 'dev-local@targus.invalid',
};

const seedGit = (dir: string, args: readonly string[], env: NodeJS.ProcessEnv = {}) =>
  git(args, dir, { ...isolated, ...env });

/**
 * GitHub commits a squash or rebase merge itself, so the commit it puts on main is a new one
 * even when its parent, tree, author and message are those of the branch's commit.
 */
const committedByGitHub: NodeJS.ProcessEnv = {
  GIT_COMMITTER_NAME: 'GitHub',
  GIT_COMMITTER_EMAIL: 'noreply@github.invalid',
};

/** Add an empty commit to the branch checked out in `dir`, and answer its sha. */
export async function commitHere(
  dir: string,
  message: string,
  env: NodeJS.ProcessEnv = {},
): Promise<string> {
  await seedGit(dir, ['commit', '--quiet', '--allow-empty', '--no-verify', '-m', message], env);
  return seedGit(dir, ['rev-parse', 'HEAD']);
}

/**
 * Create `dir` afresh as a repository with one commit on `main` and one on `feature/e2e` after
 * it, checked out. The main build is for the first, the PR build for the second.
 */
export async function createSeedCheckout(dir: string): Promise<Checkout> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await seedGit(dir, ['init', '--quiet', '--initial-branch', 'main']);
  const mainSha = await commitHere(dir, 'baseline');
  await seedGit(dir, ['switch', '--quiet', '--create', 'feature/e2e']);
  return { dir, mainSha, headSha: await commitHere(dir, 'change one story') };
}

/**
 * Land a branch on `main` the way GitHub's squash merge (one message) or rebase merge (one
 * message per commit) does: new commits on `main`, with none of the branch's own commits among
 * their ancestors. Leaves `main` checked out and answers its new tip.
 */
export async function landOnMain(dir: string, messages: readonly string[]): Promise<string> {
  await seedGit(dir, ['switch', '--quiet', 'main']);
  let tip = await seedGit(dir, ['rev-parse', 'HEAD']);
  for (const message of messages) tip = await commitHere(dir, message, committedByGitHub);
  return tip;
}

/** Start the branch `name` from what is checked out in `dir`, with one commit; its sha. */
export async function startBranch(dir: string, name: string): Promise<string> {
  await seedGit(dir, ['switch', '--quiet', '--create', name]);
  return commitHere(dir, `work on ${name}`);
}
