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

const seedGit = (dir: string, args: readonly string[]) => git(args, dir, isolated);

/**
 * Create `dir` afresh as a repository with one commit on `main` and one on `feature/e2e` after
 * it, checked out. The main build is for the first, the PR build for the second.
 */
export async function createSeedCheckout(dir: string): Promise<Checkout> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const commit = (message: string) =>
    seedGit(dir, ['commit', '--quiet', '--allow-empty', '--no-verify', '-m', message]);
  await seedGit(dir, ['init', '--quiet', '--initial-branch', 'main']);
  await commit('baseline');
  const mainSha = await seedGit(dir, ['rev-parse', 'HEAD']);
  await seedGit(dir, ['switch', '--quiet', '--create', 'feature/e2e']);
  await commit('change one story');
  return { dir, mainSha, headSha: await seedGit(dir, ['rev-parse', 'HEAD']) };
}
