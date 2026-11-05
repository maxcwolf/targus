import type { BuildTrigger } from '@targus/core';

/** The CI variables `resolveCiContext` reads. `config.ts` is what pulls them from the process. */
export interface CiEnv {
  readonly CIRCLE_BRANCH?: string | undefined;
  /** CircleCI's PR URL, e.g. `https://github.com/org/repo/pull/12`. */
  readonly CIRCLE_PULL_REQUEST?: string | undefined;
  /** Set by CircleCI only for PRs from forks. */
  readonly CIRCLE_PR_NUMBER?: string | undefined;
  /** The PR's head branch on `pull_request` events; empty on pushes. */
  readonly GITHUB_HEAD_REF?: string | undefined;
  readonly GITHUB_REF_NAME?: string | undefined;
  /** `refs/heads/<branch>` on pushes, `refs/pull/<n>/merge` on pull requests. */
  readonly GITHUB_REF?: string | undefined;
}

export interface CiOverrides {
  /** `--branch`: wins over every CI variable. */
  readonly branch?: string | undefined;
  /** `--pr`: wins over every CI variable. */
  readonly pr?: number | undefined;
  /** `--base-branch`: a build on it without a PR is a `main` build. */
  readonly baseBranch: string;
  /** What git says is checked out, used when no CI variable names a branch. */
  readonly gitBranch?: string | null | undefined;
}

export interface CiContext {
  readonly branch: string | null;
  readonly prNumber: number | null;
  readonly trigger: BuildTrigger;
}

function present(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function positiveInt(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed > 0 ? parsed : null;
}

function githubBranch(env: CiEnv): string | undefined {
  const head = present(env.GITHUB_HEAD_REF);
  if (head !== undefined) return head;
  const ref = present(env.GITHUB_REF);
  if (ref?.startsWith('refs/pull/')) return undefined;
  return present(env.GITHUB_REF_NAME) ?? ref?.replace(/^refs\/heads\//, '');
}

function ciBranch(env: CiEnv): string | undefined {
  return present(env.CIRCLE_BRANCH) ?? githubBranch(env);
}

function ciPrNumber(env: CiEnv): number | null {
  const circleUrl = present(env.CIRCLE_PULL_REQUEST);
  const fromCircle = positiveInt(circleUrl?.match(/\/pull\/(\d+)\/?$/)?.[1]);
  const fromFork = positiveInt(present(env.CIRCLE_PR_NUMBER));
  const fromGithub = positiveInt(present(env.GITHUB_REF)?.match(/^refs\/pull\/(\d+)\//)?.[1]);
  return fromCircle ?? fromFork ?? fromGithub;
}

/**
 * Derive branch, PR number and trigger from CircleCI or GitHub Actions variables (plan.md
 * section 5.1: the PR number comes from CI env). Explicit overrides win; git's branch is the
 * last resort. A build on `baseBranch` with no PR is a `main` build, anything else a `pr` build.
 */
export function resolveCiContext(env: CiEnv, overrides: CiOverrides): CiContext {
  const branch = present(overrides.branch) ?? ciBranch(env) ?? overrides.gitBranch ?? null;
  const prNumber = overrides.pr ?? ciPrNumber(env);
  const trigger = prNumber === null && branch === overrides.baseBranch ? 'main' : 'pr';
  return { branch, prNumber, trigger };
}
