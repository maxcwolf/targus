import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isBlankPng, TargusError, type Clock, type IdGenerator } from '@targus/core';

import { TargusApiClient } from '../adapters/api-client.adapter.ts';
import { cryptoIdGenerator } from '../adapters/crypto-id-generator.adapter.ts';
import { execFileBuffer, type Exec } from '../adapters/exec.adapter.ts';
import { GitCli, type GitMetadata } from '../adapters/git.adapter.ts';
import { SimctlDriver } from '../adapters/simctl.adapter.ts';
import { systemClock } from '../adapters/system-clock.adapter.ts';
import { checkAppBundle } from '../capture/app-bundle.ts';
import { compareWithCore } from '../capture/compare-images.ts';
import { sha256Hex } from '../capture/png.ts';
import type { CliConfig } from '../config.ts';
import { checkProject } from '../run/check-project.ts';
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
}

export interface RunCommandDeps {
  readonly exec: Exec;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly log: (line: string) => void;
  readonly capture: (options: CaptureCommandOptions) => Promise<unknown>;
  readonly makeTempDir: () => Promise<string>;
  /** `log` receives a warning line for each retried request. */
  readonly createApi: (baseUrl: string, token: string, log: (line: string) => void) => TargusApi;
  readonly createGit: (exec: Exec) => GitMetadata;
  readonly simulatorName: (udid: string, exec: Exec) => Promise<string | null>;
  /** Checks `--app` before the simulator boots and answers its bundle id (`checkAppBundle`). */
  readonly checkApp: (app: string, bundleId: string | undefined, exec: Exec) => Promise<string>;
}

export const defaultRunDeps: RunCommandDeps = {
  exec: execFileBuffer,
  clock: systemClock,
  ids: cryptoIdGenerator,
  log: (line) => {
    process.stdout.write(`${line}\n`);
  },
  capture: (options) => runCapture(options),
  makeTempDir: () => mkdtemp(path.join(tmpdir(), 'targus-run-')),
  createApi: (baseUrl, token, log) => new TargusApiClient({ baseUrl, token, onRetry: log }),
  createGit: (exec) => new GitCli({ exec }),
  simulatorName: (udid, exec) => new SimctlDriver({ udid, exec }).deviceName(),
  checkApp: (app, bundleId, exec) => checkAppBundle(app, { exec, bundleId }),
};

async function resolveDevice(options: RunCommandOptions, deps: RunCommandDeps): Promise<string> {
  if (options.deviceName !== undefined) return options.deviceName;
  const { udid } = options;
  if (udid === undefined) {
    throw new TargusError('bad_request', 'cannot tell the device name: pass --device-name');
  }
  const name = await deps.simulatorName(udid, deps.exec);
  if (name === null) {
    throw new TargusError(
      'bad_request',
      `no simulator with UDID ${udid} in \`xcrun simctl list devices\`: check --udid, ` +
        'or pass --device-name',
    );
  }
  return name;
}

/** Where the stories come from: a `--from-capture` directory, or the simulator and app. */
type CaptureSource =
  | { readonly kind: 'dir'; readonly dir: string }
  | { readonly kind: 'simulator'; readonly udid: string; readonly app: string };

function captureSource(options: RunCommandOptions): CaptureSource {
  if (options.fromCapture !== undefined) return { kind: 'dir', dir: options.fromCapture };
  const { udid, app } = options;
  if (udid === undefined || app === undefined) {
    throw new TargusError('bad_request', 'pass --udid and --app, or --from-capture <dir>');
  }
  return { kind: 'simulator', udid, app };
}

/** The capture directory: `--from-capture` as given, or a fresh capture from the simulator. */
async function captureDir(
  source: CaptureSource,
  bundleId: string | undefined,
  options: RunCommandOptions,
  deps: RunCommandDeps,
): Promise<string> {
  if (source.kind === 'dir') return path.resolve(source.dir);
  const dir = options.out ?? (await deps.makeTempDir());
  const flags = { ...captureFlags(options), ...(bundleId === undefined ? {} : { bundleId }) };
  await deps.capture({ ...flags, udid: source.udid, app: source.app, out: dir });
  return path.resolve(dir);
}

function captureFlags(options: CaptureFlags): CaptureFlags {
  return {
    appearance: options.appearance,
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
 * cheaply (device, app, token and project, git, branch) is checked before the minutes-long
 * capture.
 */
export async function runRun(
  options: RunCommandOptions,
  config: CliConfig,
  deps: RunCommandDeps = defaultRunDeps,
): Promise<RunBuildOutput> {
  if (config.token === undefined) {
    throw new TargusError('unauthorized', 'TARGUS_TOKEN is not set: export the project token');
  }
  const source = captureSource(options);
  const device = await resolveDevice(options, deps);
  const bundleId =
    source.kind === 'simulator'
      ? await deps.checkApp(source.app, options.bundleId, deps.exec)
      : undefined;
  const api = deps.createApi(options.apiUrl, config.token, deps.log);
  await checkProject(api, options.apiUrl, deps.log);
  const git = deps.createGit(deps.exec);
  const gitInfo = await readGitInfo(git, options.baseBranch, options.sha, deps.log);
  const ci = await resolveContext(options, config, git);
  const dir = await captureDir(source, bundleId, options, deps);
  deps.log(`loading capture from ${dir}`);
  const { report, appearance } = await loadCapture(dir);
  const output = await runBuild({
    report,
    git: gitInfo,
    ci,
    device,
    appearance,
    api,
    clock: deps.clock,
    ids: deps.ids,
    compareImages: compareWithCore,
    hash: sha256Hex,
    isBlank: isBlankPng,
    ...(source.kind === 'simulator' && options.filter !== undefined
      ? { filter: options.filter }
      : {}),
  });
  for (const line of formatRunSummary(output)) deps.log(line);
  return output;
}
