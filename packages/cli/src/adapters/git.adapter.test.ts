import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isTargusError, TargusError } from '@targus/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ExecError, type Exec } from './exec.adapter.js';
import { GitCli } from './git.adapter.js';
import { isolatedGitExec } from './git.sandbox.js';

const sha = 'a'.repeat(40);
const parent = 'b'.repeat(40);
const grandparent = 'c'.repeat(40);

/** An `Exec` answering each git subcommand (argv[0] after any -C) from `outputs`; else it fails. */
function fakeGit(outputs: Record<string, string>) {
  const calls: (readonly string[])[] = [];
  const exec: Exec = (file, args) => {
    calls.push([file, ...args]);
    const key = args.filter((arg) => arg !== '-C' && arg !== '/repo').join(' ');
    const stdout = outputs[key];
    if (stdout === undefined) return Promise.reject(new ExecError(`git ${key} failed`, 'fatal'));
    return Promise.resolve({ stdout: Buffer.from(stdout), stderr: '' });
  };
  return { exec, calls };
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

describe('GitCli timeouts', () => {
  it('gives plumbing 30s and a fetch 5 minutes', async () => {
    const timeouts: (number | undefined)[] = [];
    const exec: Exec = (_file, _args, options) => {
      timeouts.push(options?.timeoutMs);
      return Promise.resolve({ stdout: Buffer.from(`${sha}\n`), stderr: '' });
    };
    const git = new GitCli({ exec });

    await git.headSha();
    await git.mergeBase('origin/main');
    await git.fetchBase('main');

    expect(timeouts).toEqual([30_000, 30_000, 300_000]);
  });

  it('keeps the timeout error, which names the command, as it is', async () => {
    const timedOut = new TargusError('internal', 'git fetch did not finish within 5m');
    const git = new GitCli({ exec: () => Promise.reject(timedOut) });

    await expect(git.fetchBase('main')).rejects.toBe(timedOut);
    await expect(git.resolveCommit('origin/main')).rejects.toBe(timedOut);
  });
});

describe('GitCli commands', () => {
  it('reads HEAD and the current branch', async () => {
    const fake = fakeGit({
      'rev-parse HEAD': `${sha}\n`,
      'rev-parse --abbrev-ref HEAD': 'feature/button\n',
    });
    const git = new GitCli({ exec: fake.exec });

    expect(await git.headSha()).toBe(sha);
    expect(await git.currentBranch()).toBe('feature/button');
    expect(fake.calls).toEqual([
      ['git', 'rev-parse', 'HEAD'],
      ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
    ]);
  });

  it('reports a detached HEAD as no branch and runs in cwd', async () => {
    const fake = fakeGit({ 'rev-parse --abbrev-ref HEAD': 'HEAD\n' });

    expect(await new GitCli({ exec: fake.exec, cwd: '/repo' }).currentBranch()).toBeNull();
    expect(fake.calls[0]).toEqual(['git', '-C', '/repo', 'rev-parse', '--abbrev-ref', 'HEAD']);
  });

  it('throws when a command prints nothing', async () => {
    const fake = fakeGit({ 'rev-parse HEAD': '\n' });

    expect(await codeOf(new GitCli({ exec: fake.exec }).headSha())).toMatch(
      /^bad_request: .*printed nothing/,
    );
  });
});

describe('GitCli argv and errors', () => {
  it('lists first-parent ancestors from the commit itself, dropping it', async () => {
    const fake = fakeGit({
      [`rev-list --first-parent -n 101 ${sha}`]: `${sha}\n${parent}\n${grandparent}\n`,
    });

    expect(await new GitCli({ exec: fake.exec }).firstParentAncestors(sha, 100)).toEqual([
      parent,
      grandparent,
    ]);
  });

  it('fetches the base branch into origin/<base> explicitly', async () => {
    const fake = fakeGit({
      'fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main': '',
    });

    await new GitCli({ exec: fake.exec }).fetchBase('main');
    expect(fake.calls).toEqual([
      ['git', 'fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'],
    ]);
  });

  it('turns a missing git binary into an error, not a null merge base', async () => {
    const enoent = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
    const exec: Exec = () =>
      Promise.reject(
        new ExecError('git merge-base failed: spawn git ENOENT', '', { cause: enoent }),
      );

    expect(await codeOf(new GitCli({ exec }).mergeBase('origin/main'))).toBe(
      'bad_request: git merge-base failed: spawn git ENOENT',
    );
  });

  it('refuses a git too old to answer --is-shallow-repository', async () => {
    const fake = fakeGit({ 'rev-parse --is-shallow-repository': '--is-shallow-repository\n' });

    expect(await codeOf(new GitCli({ exec: fake.exec }).isShallow())).toMatch(/upgrade git$/);
  });
});

// Real repositories: what git answers, and with which exit status, is the point of these tests.
// Every git process, the GitCli ones included, runs in isolatedGitExec: an inherited GIT_DIR (as in
// a git hook running `yarn check`) would otherwise point these commands at the real repository.
const sandboxExec = isolatedGitExec();
let root: string;
let origin: string;
let rootCommit: string;
let mainTip: string;
let featureTip: string;

const identity = [
  '-c',
  'user.name=targus',
  '-c',
  'user.email=targus@example.com',
  '-c',
  'commit.gpgsign=false',
];

async function run(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await sandboxExec('git', ['-C', cwd, ...identity, ...args]);
  return stdout.toString('utf8').trim();
}

async function commit(cwd: string, subject: string): Promise<string> {
  await run(cwd, 'commit', '--allow-empty', '--quiet', '-m', subject);
  return run(cwd, 'rev-parse', 'HEAD');
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'targus-git-test-'));
  origin = path.join(root, 'origin');
  await mkdir(origin);
  await run(origin, 'init', '--quiet', '--initial-branch=main');
  rootCommit = await commit(origin, 'main 1');
  await commit(origin, 'main 2');
  mainTip = await commit(origin, 'main 3');
  await run(origin, 'checkout', '--quiet', '-b', 'feature');
  await commit(origin, 'feature 1');
  featureTip = await commit(origin, 'feature 2');
  await run(origin, 'checkout', '--quiet', '--orphan', 'unrelated');
  await commit(origin, 'unrelated 1');
  await run(origin, 'checkout', '--quiet', 'feature');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** `git clone` of `origin` checked out on `feature`; `--depth` makes it shallow and single-branch. */
async function cloneFeature(name: string, ...flags: string[]): Promise<GitCli> {
  const dir = path.join(root, name);
  await sandboxExec('git', [
    'clone',
    '--quiet',
    ...flags,
    '--branch',
    'feature',
    `file://${origin}`,
    dir,
  ]);
  return new GitCli({ exec: sandboxExec, cwd: dir });
}

describe('GitCli against a real repository', () => {
  it('resolves an existing ref and answers null for a missing one', async () => {
    const git = new GitCli({ exec: sandboxExec, cwd: origin });

    expect(await git.resolveCommit('main')).toBe(mainTip);
    expect(await git.resolveCommit('origin/nope')).toBeNull();
  });

  it('finds the merge base, and null only when the histories are unrelated', async () => {
    const git = new GitCli({ exec: sandboxExec, cwd: origin });

    expect(await git.mergeBase('main')).toBe(mainTip);
    expect(await git.mergeBase('unrelated')).toBeNull();
    expect(await codeOf(git.mergeBase('origin/nope'))).toMatch(/^bad_request: .*origin\/nope/);
  });

  it('lists ancestors nearest first, none for a root commit, and fails on a bad sha', async () => {
    const git = new GitCli({ exec: sandboxExec, cwd: origin });

    expect(await git.firstParentAncestors(mainTip, 100)).toHaveLength(2);
    expect(await git.firstParentAncestors(mainTip, 1)).toEqual([
      await run(origin, 'rev-parse', `${mainTip}^`),
    ]);
    expect(await git.firstParentAncestors(rootCommit, 100)).toEqual([]);
    expect(await codeOf(git.firstParentAncestors('f'.repeat(40), 100))).toMatch(/^bad_request: /);
  });
});

describe('GitCli against a real repository: failures and clones', () => {
  it('fails every method outside a repository', async () => {
    const empty = path.join(root, 'not-a-repo');
    await mkdir(empty);
    const git = new GitCli({ exec: sandboxExec, cwd: empty });

    const calls = [
      () => git.headSha(),
      () => git.isShallow(),
      () => git.mergeBase('main'),
      () => git.resolveCommit('main'),
    ];
    for (const call of calls) {
      expect(await codeOf(call())).toMatch(/^bad_request: .*not a git repository/);
    }
  });

  it('tells a shallow clone from a full one', async () => {
    expect(await new GitCli({ exec: sandboxExec, cwd: origin }).isShallow()).toBe(false);
    expect(await (await cloneFeature('shallow', '--depth', '1')).isShallow()).toBe(true);
  });

  it('fetches the base into origin/<base> even in a single-branch clone', async () => {
    const git = await cloneFeature('single', '--single-branch');
    expect(await git.resolveCommit('origin/main')).toBeNull();

    await git.fetchBase('main');

    expect(await git.resolveCommit('origin/main')).toBe(mainTip);
    expect(await git.mergeBase('origin/main')).toBe(mainTip);
    expect(await git.headSha()).toBe(featureTip);
  });

  it('fails a fetch of a branch origin does not have', async () => {
    const git = await cloneFeature('missing-branch');

    expect(await codeOf(git.fetchBase('nope'))).toMatch(/^bad_request: .*nope/);
  });
});
