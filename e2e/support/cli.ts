import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { e2eConfig } from '../config.ts';

const execFileAsync = promisify(execFile);

export const repoRoot = path.resolve(import.meta.dirname, '..', '..');
/** The built CLI; the `e2e` script runs `yarn workspace @targus/cli build` first. */
const cliBin = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js');

/** A git checkout `targus run` publishes from, and the two commits the builds are for. */
export interface Checkout {
  readonly dir: string;
  /** The main build's commit: the merge base of `headSha` with main. */
  readonly mainSha: string;
  /** The PR build's commit, checked out in `dir`. */
  readonly headSha: string;
}

/**
 * PATH and HOME only, so an inherited `GIT_DIR` (git hooks export it) never redirects git, and
 * git never looks for a repository above `cwd`.
 */
function gitEnv(cwd: string): NodeJS.ProcessEnv {
  return {
    PATH: e2eConfig.path,
    ...(e2eConfig.home === undefined ? {} : { HOME: e2eConfig.home }),
    GIT_CEILING_DIRECTORIES: path.dirname(cwd),
  };
}

/** Run git in `cwd` (the repo by default) with `gitEnv` plus `env`; resolves to its stdout. */
export async function git(
  args: readonly string[],
  cwd = repoRoot,
  env: NodeJS.ProcessEnv = {},
): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, env: { ...gitEnv(cwd), ...env } });
  return stdout.trim();
}

/** `git rev-parse HEAD` of the repo: the CLI reads git from its cwd, which is the repo. */
export function headSha(): Promise<string> {
  return git(['rev-parse', 'HEAD']);
}

/**
 * The merge base `targus run` will report for a PR build from this checkout (`origin/main`,
 * else `main`, as commands/run.ts resolves it). A main build on this sha is the PR build's
 * baseline, whichever branch the e2e suite runs from.
 */
export async function mergeBaseSha(): Promise<string> {
  for (const ref of ['origin/main', 'main']) {
    const sha = await git(['merge-base', ref, 'HEAD']).catch(() => null);
    if (sha !== null) return sha;
  }
  return headSha();
}

/** This repo as the checkout the e2e specs publish from. It needs its history (not shallow). */
export async function repoCheckout(): Promise<Checkout> {
  return { dir: repoRoot, mainSha: await mergeBaseSha(), headSha: await headSha() };
}

/**
 * A minimal environment for the CLI: no CI variables leak in (the flags decide branch and PR),
 * and git never prompts, so the best-effort `git fetch origin <base>` fails fast offline.
 */
function cliEnv(token: string, cwd: string): NodeJS.ProcessEnv {
  return {
    ...gitEnv(cwd),
    TARGUS_TOKEN: token,
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=5',
  };
}

export interface TargusRun {
  readonly buildId: string;
  readonly stdout: string;
}

/**
 * Run `targus run <args>` in `cwd` (the repo by default), whose git the CLI reads, and read the
 * `build: <id>` line it prints.
 */
export async function targusRun(
  token: string,
  args: readonly string[],
  cwd = repoRoot,
): Promise<TargusRun> {
  const { stdout } = await execFileAsync(process.execPath, [cliBin, 'run', ...args], {
    cwd,
    env: cliEnv(token, cwd),
  });
  const buildId = /^build: (\S+)$/m.exec(stdout)?.[1];
  if (buildId === undefined) throw new Error(`targus run printed no build id:\n${stdout}`);
  return { buildId, stdout };
}
