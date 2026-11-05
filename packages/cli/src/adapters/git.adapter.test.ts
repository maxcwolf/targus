import { describe, expect, it } from 'vitest';

import { ExecError, type Exec } from './exec.adapter.js';
import { GitCli } from './git.adapter.js';

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

describe('GitCli', () => {
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

    await expect(new GitCli({ exec: fake.exec }).headSha()).rejects.toThrow('printed nothing');
  });

  it('finds the merge base, or null when git cannot', async () => {
    const fake = fakeGit({ 'merge-base origin/main HEAD': `${parent}\n` });
    const git = new GitCli({ exec: fake.exec });

    expect(await git.mergeBase('origin/main')).toBe(parent);
    expect(await git.mergeBase('origin/nope')).toBeNull();
  });

  it('lists first-parent ancestors excluding the commit itself, nearest first', async () => {
    const fake = fakeGit({
      [`rev-list --first-parent -n 100 ${sha}^`]: `${parent}\n${grandparent}\n`,
    });

    expect(await new GitCli({ exec: fake.exec }).firstParentAncestors(sha, 100)).toEqual([
      parent,
      grandparent,
    ]);
    expect(fake.calls).toEqual([['git', 'rev-list', '--first-parent', '-n', '100', `${sha}^`]]);
  });

  it('returns no ancestors for a root commit', async () => {
    const fake = fakeGit({});

    expect(await new GitCli({ exec: fake.exec }).firstParentAncestors(sha, 100)).toEqual([]);
  });

  it('fetches the base branch and ignores a failed fetch', async () => {
    const ok = fakeGit({ 'fetch --no-tags origin main': '' });
    await new GitCli({ exec: ok.exec }).fetchBase('main');
    expect(ok.calls).toEqual([['git', 'fetch', '--no-tags', 'origin', 'main']]);

    await expect(new GitCli({ exec: fakeGit({}).exec }).fetchBase('main')).resolves.toBeUndefined();
  });
});
