import { execFileBuffer, type Exec } from './exec.adapter.js';

/**
 * What `targus run` needs to know about the checkout (plan.md section 5.1, ADR 0004). Defined in
 * the CLI rather than core because only the CLI reads git.
 */
export interface GitMetadata {
  /** The full sha of `HEAD`. */
  headSha(): Promise<string>;
  /** The checked-out branch, or `null` on a detached `HEAD`. */
  currentBranch(): Promise<string | null>;
  /** `git merge-base <baseRef> HEAD`, or `null` when git cannot find one (unknown ref, no history). */
  mergeBase(baseRef: string): Promise<string | null>;
  /** First-parent ancestors of `sha`, excluding `sha` itself, nearest first; `[]` for a root commit. */
  firstParentAncestors(sha: string, limit: number): Promise<readonly string[]>;
  /** Best effort `git fetch origin <branch>` so `origin/<branch>` exists in CI checkouts. */
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

  async mergeBase(baseRef: string): Promise<string | null> {
    try {
      return await this.single(['merge-base', baseRef, 'HEAD']);
    } catch {
      return null;
    }
  }

  async firstParentAncestors(sha: string, limit: number): Promise<readonly string[]> {
    try {
      return lines(await this.git(['rev-list', '--first-parent', '-n', String(limit), `${sha}^`]));
    } catch {
      // `<sha>^` does not resolve on a root commit: it has no ancestors.
      return [];
    }
  }

  async fetchBase(baseBranch: string): Promise<void> {
    await this.git(['fetch', '--no-tags', 'origin', baseBranch]).catch(() => undefined);
  }

  private async git(args: readonly string[]): Promise<Buffer> {
    const { stdout } = await this.exec('git', [...this.cwd, ...args]);
    return stdout;
  }

  private async single(args: readonly string[]): Promise<string> {
    const [first] = lines(await this.git(args));
    if (first === undefined) throw new Error(`git ${args.join(' ')} printed nothing`);
    return first;
  }
}
