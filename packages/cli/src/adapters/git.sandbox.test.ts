import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { inheritedEnv } from '../config.ts';
import { execFileBuffer } from './exec.adapter.ts';
import { GitCli } from './git.adapter.ts';
import { isolatedGitEnv, isolatedGitExec } from './git.sandbox.ts';

// A throwaway repository stands in for the one a git hook runs in: the hostile environment below
// points GIT_DIR at it, the way git does for hooks, and nothing here may change it.
let root: string;
let decoy: string;
let hostile: Record<string, string | undefined>;

const clean = isolatedGitExec();

async function git(exec: typeof clean, cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args]);
  return stdout.toString('utf8').trim();
}

/** Everything a stray `init` or `commit` would change: config, HEAD and every ref. */
async function snapshot(repo: string): Promise<readonly string[]> {
  return [
    await readFile(path.join(repo, '.git', 'config'), 'utf8'),
    await readFile(path.join(repo, '.git', 'HEAD'), 'utf8'),
    await git(clean, repo, 'for-each-ref'),
  ];
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'targus-git-sandbox-test-'));
  decoy = path.join(root, 'decoy');
  await mkdir(decoy);
  await git(clean, decoy, 'init', '--quiet', '--initial-branch=trunk');
  const identity = ['-c', 'user.name=targus', '-c', 'user.email=targus@example.com'];
  await git(clean, decoy, ...identity, 'commit', '--allow-empty', '--quiet', '-m', 'decoy');
  hostile = {
    ...inheritedEnv(),
    GIT_DIR: path.join(decoy, '.git'),
    GIT_WORK_TREE: decoy,
    GIT_INDEX_FILE: path.join(decoy, '.git', 'index'),
  };
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('isolatedGitEnv', () => {
  it('drops every GIT_ variable and ignores global and system config', () => {
    const env = isolatedGitEnv({
      PATH: '/bin',
      GIT_DIR: '/x',
      GIT_NAMESPACE: 'n',
      HOME: undefined,
    });

    expect(env).toEqual({
      PATH: '/bin',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    });
  });
});

describe('isolatedGitExec with GIT_DIR inherited from a hook', () => {
  it('is needed: the inherited environment sends git -C <dir> to GIT_DIR instead', async () => {
    const elsewhere = path.join(root, 'elsewhere');
    await mkdir(elsewhere);
    const inherited = await execFileBuffer(
      'git',
      ['-C', elsewhere, 'rev-parse', '--absolute-git-dir'],
      { env: { GIT_DIR: path.join(decoy, '.git') } },
    );

    expect(await realpath(inherited.stdout.toString('utf8').trim())).toBe(
      await realpath(path.join(decoy, '.git')),
    );
  });

  it('runs init and the adapter in the -C directory and leaves GIT_DIR untouched', async () => {
    const before = await snapshot(decoy);
    const target = path.join(root, 'target');
    await mkdir(target);
    const exec = isolatedGitExec(hostile);

    await git(exec, target, 'init', '--quiet', '--initial-branch=main');
    const adapter = new GitCli({ exec, cwd: target });

    expect(await adapter.isShallow()).toBe(false);
    expect(await adapter.resolveCommit('trunk')).toBeNull();
    expect(await realpath(await git(exec, target, 'rev-parse', '--absolute-git-dir'))).toBe(
      await realpath(path.join(target, '.git')),
    );
    expect(await snapshot(decoy)).toEqual(before);
    expect((await snapshot(decoy))[0]).not.toMatch(/bare = true/);
  });

  it('fails like execFileBuffer, with the exit status on the cause', async () => {
    const failure: unknown = await clean('git', ['-C', root, 'rev-parse', 'HEAD']).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ name: 'ExecError', cause: { code: 128 } });
    expect(failure instanceof Error && failure.message).toMatch(/not a git repository/);
  });
});
