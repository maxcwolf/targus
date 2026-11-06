import { isTargusError, TargusError } from '@targus/core';

import { execFileBuffer, type Exec } from './exec.adapter.ts';

/**
 * What `targus run` needs to know about the checkout (plan.md section 5.1, ADR 0004). Defined in
 * the CLI rather than core because only the CLI reads git.
 *
 * Every method throws a `bad_request` `TargusError` when git fails (not a repository, unknown
 * revision, git missing). Only an answer from git that there is nothing comes back as `null`.
 */
export interface GitMetadata {
  /** The full sha of `HEAD`. */
  headSha(): Promise<string>;
  /** The checked-out branch, or `null` on a detached `HEAD`. */
  currentBranch(): Promise<string | null>;
  /** Whether the checkout is a shallow clone, whose history stops before the root. */
  isShallow(): Promise<boolean>;
  /** The commit sha `ref` names, or `null` when no such ref exists. */
  resolveCommit(ref: string): Promise<string | null>;
  /** `git merge-base <baseRef> HEAD`, or `null` when the two share no history. */
  mergeBase(baseRef: string): Promise<string | null>;
  /** First-parent ancestors of `sha`, excluding `sha` itself, nearest first; `[]` for a root commit. */
  firstParentAncestors(sha: string, limit: number): Promise<readonly string[]>;
  /** `git fetch origin <branch>` into `origin/<branch>`, which exists afterwards even in a single-branch clone. */
  fetchBase(baseBranch: string): Promise<void>;
}

export interface GitCliOptions {
  readonly exec?: Exec;
  /** Repository to run in; defaults to the process working directory. */
  readonly cwd?: string;
}

function lines(stdout: Buffer): string[] {
  return stdout
    .toString('utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** The exit status of a failed git call, or `null` when git did not run (missing binary). */
function exitStatus(error: unknown): number | null {
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return null;
  return typeof cause.code === 'number' ? cause.code : null;
}

/** Plumbing answers at once; a fetch may pull a large history over a slow network. */
export const gitTimeoutMs = 30_000;
export const gitFetchTimeoutMs = 5 * 60_000;

/** A failed git call as a `bad_request`; a timeout keeps its own error, which names the command. */
function gitError(error: unknown): TargusError {
  if (isTargusError(error)) return error;
  return new TargusError('bad_request', message(error), { cause: error });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `GitMetadata` over the `git` binary, one plumbing command per method. */
export class GitCli implements GitMetadata {
  private readonly exec: Exec;
  private readonly cwd: readonly string[];

  constructor({ exec = execFileBuffer, cwd }: GitCliOptions = {}) {
    this.exec = exec;
    this.cwd = cwd === undefined ? [] : ['-C', cwd];
  }

  async headSha(): Promise<string> {
    return this.single(['rev-parse', 'HEAD']);
  }

  async currentBranch(): Promise<string | null> {
    const branch = await this.single(['rev-parse', '--abbrev-ref', 'HEAD']);
    return branch === 'HEAD' ? null : branch;
  }

  async isShallow(): Promise<boolean> {
    const args = ['rev-parse', '--is-shallow-repository'];
    const answer = await this.single(args);
    if (answer === 'true' || answer === 'false') return answer === 'true';
    // git before 2.15 echoes the unknown flag back instead of answering.
    throw new TargusError('bad_request', `git ${args.join(' ')} printed ${answer}: upgrade git`);
  }

  async resolveCommit(ref: string): Promise<string | null> {
    // `--verify --quiet` exits 1 and prints nothing when the ref does not exist.
    const stdout = await this.gitOrNull(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return stdout === null ? null : (lines(stdout)[0] ?? null);
  }

  async mergeBase(baseRef: string): Promise<string | null> {
    // `merge-base` exits 1 and prints nothing when the commits share no history.
    const stdout = await this.gitOrNull(['merge-base', baseRef, 'HEAD']);
    return stdout === null ? null : (lines(stdout)[0] ?? null);
  }

  async firstParentAncestors(sha: string, limit: number): Promise<readonly string[]> {
    // Listing from `sha` itself (and dropping it) works on a root commit, where `sha^` would not.
    const listed = lines(
      await this.git(['rev-list', '--first-parent', '-n', String(limit + 1), sha]),
    );
    return listed.slice(1);
  }

  async fetchBase(baseBranch: string): Promise<void> {
    // An explicit destination: a single-branch clone's refspec would only update FETCH_HEAD.
    const refspec = `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`;
    await this.git(['fetch', '--no-tags', 'origin', refspec], gitFetchTimeoutMs);
  }

  private async git(args: readonly string[], timeoutMs = gitTimeoutMs): Promise<Buffer> {
    try {
      const { stdout } = await this.exec('git', [...this.cwd, ...args], { timeoutMs });
      return stdout;
    } catch (error) {
      throw gitError(error);
    }
  }

  /** Like `git`, but exit status 1 is git's answer "there is none": `null` instead of an error. */
  private async gitOrNull(args: readonly string[]): Promise<Buffer | null> {
    try {
      const { stdout } = await this.exec('git', [...this.cwd, ...args], {
        timeoutMs: gitTimeoutMs,
      });
      return stdout;
    } catch (error) {
      if (exitStatus(error) === 1) return null;
      throw gitError(error);
    }
  }

  private async single(args: readonly string[]): Promise<string> {
    const [first] = lines(await this.git(args));
    if (first === undefined) {
      throw new TargusError('bad_request', `git ${args.join(' ')} printed nothing`);
    }
    return first;
  }
}
