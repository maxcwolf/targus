import { describe, expect, it } from 'vitest';

import { resolveCiContext, type CiContext, type CiEnv, type CiOverrides } from './ci-context.ts';

interface Case {
  readonly name: string;
  readonly env: CiEnv;
  readonly overrides?: Partial<CiOverrides>;
  readonly expected: CiContext;
}

const cases: readonly Case[] = [
  {
    name: 'CircleCI PR build',
    env: {
      CIRCLE_BRANCH: 'feature/button',
      CIRCLE_PULL_REQUEST: 'https://github.com/example-org/example-app/pull/42',
    },
    expected: { branch: 'feature/button', prNumber: 42, trigger: 'pr' },
  },
  {
    name: 'CircleCI fork PR number',
    env: { CIRCLE_BRANCH: 'pull/7', CIRCLE_PR_NUMBER: '7' },
    expected: { branch: 'pull/7', prNumber: 7, trigger: 'pr' },
  },
  {
    name: 'CircleCI main push',
    env: { CIRCLE_BRANCH: 'main', CIRCLE_PULL_REQUEST: '' },
    expected: { branch: 'main', prNumber: null, trigger: 'main' },
  },
  {
    name: 'CircleCI branch push without a PR',
    env: { CIRCLE_BRANCH: 'feature/wip' },
    expected: { branch: 'feature/wip', prNumber: null, trigger: 'pr' },
  },
  {
    name: 'GitHub Actions pull_request',
    env: {
      GITHUB_HEAD_REF: 'feature/button',
      GITHUB_REF_NAME: '12/merge',
      GITHUB_REF: 'refs/pull/12/merge',
    },
    expected: { branch: 'feature/button', prNumber: 12, trigger: 'pr' },
  },
  {
    name: 'GitHub Actions push to main',
    env: { GITHUB_HEAD_REF: '', GITHUB_REF_NAME: 'main', GITHUB_REF: 'refs/heads/main' },
    expected: { branch: 'main', prNumber: null, trigger: 'main' },
  },
  {
    name: 'GitHub Actions with only GITHUB_REF',
    env: { GITHUB_REF: 'refs/heads/release/1.2' },
    expected: { branch: 'release/1.2', prNumber: null, trigger: 'pr' },
  },
  {
    name: 'GitHub pull ref without a head ref falls back to git',
    env: { GITHUB_REF: 'refs/pull/3/merge' },
    overrides: { gitBranch: 'local' },
    expected: { branch: 'local', prNumber: 3, trigger: 'pr' },
  },
  {
    name: 'no CI: git branch',
    env: {},
    overrides: { gitBranch: 'main' },
    expected: { branch: 'main', prNumber: null, trigger: 'main' },
  },
  {
    name: 'no CI, detached HEAD',
    env: {},
    overrides: { gitBranch: null },
    expected: { branch: null, prNumber: null, trigger: 'pr' },
  },
  {
    name: 'overrides win over CI',
    env: { CIRCLE_BRANCH: 'main', CIRCLE_PULL_REQUEST: 'https://github.com/o/r/pull/1' },
    overrides: { branch: 'feature/x', pr: 99 },
    expected: { branch: 'feature/x', prNumber: 99, trigger: 'pr' },
  },
  {
    name: 'custom base branch',
    env: { CIRCLE_BRANCH: 'develop' },
    overrides: { baseBranch: 'develop' },
    expected: { branch: 'develop', prNumber: null, trigger: 'main' },
  },
  {
    name: 'a malformed PR URL is ignored',
    env: { CIRCLE_BRANCH: 'x', CIRCLE_PULL_REQUEST: 'https://github.com/o/r/pull/abc' },
    expected: { branch: 'x', prNumber: null, trigger: 'pr' },
  },
  {
    name: 'PR number 0 is not a PR',
    env: { CIRCLE_BRANCH: 'main', CIRCLE_PR_NUMBER: '0' },
    expected: { branch: 'main', prNumber: null, trigger: 'main' },
  },
];

describe('resolveCiContext', () => {
  it.each(cases)('$name', ({ env, overrides, expected }) => {
    expect(resolveCiContext(env, { baseBranch: 'main', ...overrides })).toEqual(expected);
  });
});
