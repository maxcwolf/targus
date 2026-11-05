import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isBlankPng, TargusError, type Clock } from '@targus/core';

import { TargusApiClient } from '../adapters/api-client.adapter.js';
import { execFileBuffer, type Exec } from '../adapters/exec.adapter.js';
import { GitCli, type GitMetadata } from '../adapters/git.adapter.js';
import { SimctlDriver } from '../adapters/simctl.adapter.js';
import { systemClock } from '../adapters/system-clock.adapter.js';
import { compareWithCore } from '../capture/compare-images.js';
import { sha256Hex } from '../capture/png.js';
import type { CliConfig } from '../config.js';
import { resolveCiContext, type CiContext } from '../run/ci-context.js';
import { loadCapture } from '../run/load-capture.js';
import { maxAncestors, runBuild, type RunBuildOutput, type RunGitInfo } from '../run/run-build.js';
import { formatRunSummary } from '../run/run-summary.js';
import type { TargusApi } from '../run/targus-api.js';
import { runCapture, type CaptureCommandOptions } from './capture.js';

/** The `capture` options, optional where `--from-capture` makes them unnecessary. */
type CaptureFlags = Omit<CaptureCommandOptions, 'udid' | 'app' | 'out'>;

export interface RunCommandOptions extends CaptureFlags {
  readonly udid?: string;
  readonly app?: string;
  /** Where the capture is written; a fresh temp directory by default. */
  readonly out?: string;
  /** Skip the simulator and load a previous `targus capture` directory. */
  readonly fromCapture?: string;
  readonly apiUrl: string;
  readonly deviceName?: string;
  readonly baseBranch: string;
  readonly branch?: string;
  readonly pr?: number;
  /** Commit the build is for, instead of `git rev-parse HEAD` (already validated as a GitSha). */
  readonly sha?: string;
  readonly threshold: number;
}

export interface RunCommandDeps {
  readonly exec: Exec;
  readonly clock: Clock;
  readonly log: (line: string) => void;
  readonly capture: (options: CaptureCommandOptions) => Promise<unknown>;
  readonly makeTempDir: () => Promise<string>;
  readonly createApi: (baseUrl: string, token: string) => TargusApi;
  readonly createGit: (exec: Exec) => GitMetadata;
  readonly simulatorName: (udid: string, exec: Exec) => Promise<string | null>;
}

export const defaultRunDeps: RunCommandDeps = {
  exec: execFileBuffer,
  clock: systemClock,
  log: (line) => {
    process.stdout.write(`${line}\n`);
  },
  capture: (options) => runCapture(options),
  makeTempDir: () => mkdtemp(path.join(tmpdir(), 'targus-run-')),
  createApi: (baseUrl, token) => new TargusApiClient({ baseUrl, token }),
  createGit: (exec) => new GitCli({ exec }),
  simulatorName: (udid, exec) => new SimctlDriver({ udid, exec }).deviceName(),
};

async function readHeadSha(git: GitMetadata): Promise<string> {
  return git.headSha().catch((error: unknown) => {
    throw new TargusError('bad_request', 'cannot read git HEAD: run targus run in a git checkout', {
      cause: error,
    });
  });
}

/**
 * sha, merge base with the base branch and its first-parent ancestors (ADR 0004). `sha`
 * (from `--sha`) replaces `HEAD` as the build's commit; the merge base is still that of `HEAD`.
 */
export async function readGitInfo(
  git: GitMetadata,
  baseBranch: string,
  sha?: string,
): Promise<RunGitInfo> {
  await git.fetchBase(baseBranch);
  const buildSha = sha ?? (await readHeadSha(git));
  const mergeBaseSha =
    (await git.mergeBase(`origin/${baseBranch}`)) ?? (await git.mergeBase(baseBranch));
  const ancestors =
    mergeBaseSha === null ? [] : await git.firstParentAncestors(mergeBaseSha, maxAncestors);
  return { sha: buildSha, mergeBaseSha, ancestors };
}

async function resolveDevice(options: RunCommandOptions, deps: RunCommandDeps): Promise<string> {
  if (options.deviceName !== undefined) return options.deviceName;
  const name =
    options.udid === undefined ? null : await deps.simulatorName(options.udid, deps.exec);
  if (name === null) {
    throw new TargusError('bad_request', 'cannot tell the device name: pass --device-name');
  }
  return name;
}

/** The capture directory: `--from-capture` as given, or a fresh capture from the simulator. */
async function captureDir(options: RunCommandOptions, deps: RunCommandDeps): Promise<string> {
  if (options.fromCapture !== undefined) return path.resolve(options.fromCapture);
  const { udid, app } = options;
  if (udid === undefined || app === undefined) {
    throw new TargusError('bad_request', 'pass --udid and --app, or --from-capture <dir>');
  }
  const dir = options.out ?? (await deps.makeTempDir());
  await deps.capture({ ...captureFlags(options), udid, app, out: dir });
  return path.resolve(dir);
}

function captureFlags(options: CaptureFlags): CaptureFlags {
  return {
    port: options.port,
    settle: options.settle,
    stabilityGap: options.stabilityGap,
    renderTimeout: options.renderTimeout,
    connectTimeout: options.connectTimeout,
    attempts: options.attempts,
    ...(options.bundleId === undefined ? {} : { bundleId: options.bundleId }),
    ...(options.filter === undefined ? {} : { filter: options.filter }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  };
}

async function resolveContext(
  options: RunCommandOptions,
  config: CliConfig,
  git: GitMetadata,
): Promise<CiContext> {
  const context = resolveCiContext(config.ci, {
    branch: options.branch,
    pr: options.pr,
    baseBranch: options.baseBranch,
    gitBranch: await git.currentBranch(),
  });
  if (context.branch === null) {
    throw new TargusError('bad_request', 'cannot tell the branch (detached HEAD): pass --branch');
  }
  return context;
}

/**
 * `targus run`: capture (or load `--from-capture`), open a build, diff against the baselines
 * locally, upload images and submit the results (plan.md section 4). Everything that can fail
 * cheaply (token, git, branch, device) is checked before the minutes-long capture.
 */
export async function runRun(
  options: RunCommandOptions,
  config: CliConfig,
  deps: RunCommandDeps = defaultRunDeps,
): Promise<RunBuildOutput> {
  if (config.token === undefined) {
    throw new TargusError('unauthorized', 'TARGUS_TOKEN is not set: export the project token');
  }
  const git = deps.createGit(deps.exec);
  const gitInfo = await readGitInfo(git, options.baseBranch, options.sha);
  const ci = await resolveContext(options, config, git);
  const device = await resolveDevice(options, deps);
  const dir = await captureDir(options, deps);
  deps.log(`loading capture from ${dir}`);
  const output = await runBuild({
    report: await loadCapture(dir),
    git: gitInfo,
    ci,
    device,
    api: deps.createApi(options.apiUrl, config.token),
    clock: deps.clock,
    threshold: options.threshold,
    compareImages: compareWithCore,
    hash: sha256Hex,
    isBlank: isBlankPng,
  });
  for (const line of formatRunSummary(output)) deps.log(line);
  return output;
}
