import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isBlankPng, TargusError, type Clock } from '@targus/core';

import { TargusApiClient } from '../adapters/api-client.adapter.ts';
import { execFileBuffer, type Exec } from '../adapters/exec.adapter.ts';
import { GitCli, type GitMetadata } from '../adapters/git.adapter.ts';
import { SimctlDriver } from '../adapters/simctl.adapter.ts';
import { systemClock } from '../adapters/system-clock.adapter.ts';
import { compareWithCore } from '../capture/compare-images.ts';
import { sha256Hex } from '../capture/png.ts';
import type { CliConfig } from '../config.ts';
import { resolveCiContext, type CiContext } from '../run/ci-context.ts';
import { readGitInfo } from '../run/git-info.ts';
import { loadCapture } from '../run/load-capture.ts';
import { runBuild, type RunBuildOutput } from '../run/run-build.ts';
import { formatRunSummary } from '../run/run-summary.ts';
import type { TargusApi } from '../run/targus-api.ts';
import { runCapture, type CaptureCommandOptions } from './capture.ts';

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
  /** `log` receives a warning line for each retried request. */
  readonly createApi: (baseUrl: string, token: string, log: (line: string) => void) => TargusApi;
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
  createApi: (baseUrl, token, log) => new TargusApiClient({ baseUrl, token, onRetry: log }),
  createGit: (exec) => new GitCli({ exec }),
  simulatorName: (udid, exec) => new SimctlDriver({ udid, exec }).deviceName(),
};

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
  const gitInfo = await readGitInfo(git, options.baseBranch, options.sha, deps.log);
  const ci = await resolveContext(options, config, git);
  const device = await resolveDevice(options, deps);
  const dir = await captureDir(options, deps);
  deps.log(`loading capture from ${dir}`);
  const output = await runBuild({
    report: await loadCapture(dir),
    git: gitInfo,
    ci,
    device,
    api: deps.createApi(options.apiUrl, config.token, deps.log),
    clock: deps.clock,
    threshold: options.threshold,
    compareImages: compareWithCore,
    hash: sha256Hex,
    isBlank: isBlankPng,
  });
  for (const line of formatRunSummary(output)) deps.log(line);
  return output;
}
