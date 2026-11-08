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
import { readCaptureManifest } from '../capture/manifest.ts';
import { loadCapture } from '../run/load-capture.ts';
import { runBuild, type RunBuildOutput, type RunGitInfo } from '../run/run-build.ts';
import { formatRunSummary } from '../run/run-summary.ts';
import type { TargusApi } from '../run/targus-api.ts';
import { loadProjectConfig, type ProjectConfig } from '../project-config.ts';
import { resolveTargets, type RunTarget, type TargetFlags } from '../run/run-targets.ts';
import { runCapture, type CaptureCommandOptions } from './capture.ts';
import { runWebCapture, type WebCaptureOptions } from './capture-web.ts';

/** The capture tuning flags; the device and Storybook come from the targets (ADR 0038). */
type CaptureFlags = Omit<CaptureCommandOptions, 'udid' | 'app' | 'out' | 'appearance'>;

export interface RunCommandOptions extends CaptureFlags, TargetFlags {
  /** Where the capture is written; a fresh temp directory by default, per platform. */
  readonly out?: string;
  /** `--config`: the project config file (default: `targus.config.ts` or `.json` if present). */
  readonly config?: string;
  readonly apiUrl: string;
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
  readonly captureWeb: (options: WebCaptureOptions) => Promise<unknown>;
  readonly makeTempDir: () => Promise<string>;
  /** `log` receives a warning line for each retried request. */
  readonly createApi: (baseUrl: string, token: string, log: (line: string) => void) => TargusApi;
  readonly createGit: (exec: Exec) => GitMetadata;
  readonly simulatorName: (udid: string, exec: Exec) => Promise<string | null>;
  /** Checks `--app` before the simulator boots and answers its bundle id (`checkAppBundle`). */
  readonly checkApp: (app: string, bundleId: string | undefined, exec: Exec) => Promise<string>;
  readonly loadProjectConfig: (file: string | undefined) => Promise<ProjectConfig | null>;
}

export const defaultRunDeps: RunCommandDeps = {
  exec: execFileBuffer,
  clock: systemClock,
  ids: cryptoIdGenerator,
  log: (line) => {
    process.stdout.write(`${line}\n`);
  },
  capture: (options) => runCapture(options),
  captureWeb: (options) => runWebCapture(options),
  makeTempDir: () => mkdtemp(path.join(tmpdir(), 'targus-run-')),
  createApi: (baseUrl, token, log) => new TargusApiClient({ baseUrl, token, onRetry: log }),
  createGit: (exec) => new GitCli({ exec }),
  simulatorName: (udid, exec) => new SimctlDriver({ udid, exec }).deviceName(),
  checkApp: (app, bundleId, exec) => checkAppBundle(app, { exec, bundleId }),
  loadProjectConfig: (file) =>
    loadProjectConfig({ cwd: process.cwd(), ...(file === undefined ? {} : { file }) }),
};

/** A target with what was checked before any capture: the device name and the bundle id. */
interface PreparedTarget {
  readonly target: RunTarget;
  /** Null when the capture itself names the device (a browser, or a capture directory). */
  readonly device: string | null;
  readonly bundleId?: string;
}

async function simulatorDevice(udid: string, deps: RunCommandDeps): Promise<string> {
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

const noDeviceName = 'cannot tell the device name: pass --device-name';

/** A capture directory names its device only when it is a web capture (the browser). */
async function capturedDevice(dir: string): Promise<string> {
  const manifest = await readCaptureManifest(path.resolve(dir)).catch(() => null);
  const name = manifest?.summary.device.name ?? null;
  if (name === null) throw new TargusError('bad_request', noDeviceName);
  return name;
}

async function prepareTarget(target: RunTarget, deps: RunCommandDeps): Promise<PreparedTarget> {
  if (target.kind === 'dir') {
    return { target, device: target.deviceName ?? (await capturedDevice(target.dir)) };
  }
  if (target.kind === 'web') return { target, device: target.deviceName ?? null };
  const device = target.deviceName ?? (await simulatorDevice(target.udid, deps));
  const bundleId = await deps.checkApp(target.app, target.bundleId, deps.exec);
  return { target, device, bundleId };
}

function captureFlags(options: RunCommandOptions) {
  return {
    settle: options.settle,
    stabilityGap: options.stabilityGap,
    renderTimeout: options.renderTimeout,
    attempts: options.attempts,
    ...(options.filter === undefined ? {} : { filter: options.filter }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  };
}

/** The capture directory: a `--from-capture` one as given, or a fresh capture of the target. */
async function captureDir(
  prepared: PreparedTarget,
  out: string | undefined,
  options: RunCommandOptions,
  deps: RunCommandDeps,
): Promise<string> {
  const { target } = prepared;
  if (target.kind === 'dir') return path.resolve(target.dir);
  const dir = out ?? (await deps.makeTempDir());
  if (target.kind === 'web') {
    const { storybook, viewport, pixelRatio } = target;
    await deps.captureWeb({ ...captureFlags(options), storybook, viewport, pixelRatio, out: dir });
    return path.resolve(dir);
  }
  await deps.capture({
    ...captureFlags(options),
    udid: target.udid,
    app: target.app,
    out: dir,
    appearance: target.appearance,
    port: options.port,
    connectTimeout: options.connectTimeout,
    ...(prepared.bundleId === undefined ? {} : { bundleId: prepared.bundleId }),
  });
  return path.resolve(dir);
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

interface RunShared {
  readonly options: RunCommandOptions;
  readonly deps: RunCommandDeps;
  readonly api: TargusApi;
  readonly git: RunGitInfo;
  readonly ci: CiContext;
  /** More than one platform: each capture goes to its own subdirectory of `--out`. */
  readonly several: boolean;
}

/** A `--from-capture` directory must hold the platform `--platform` asked for. */
function checkCapturePlatform(target: RunTarget, dir: string, platform: string): void {
  if (target.kind !== 'dir' || target.platform === undefined || target.platform === platform) {
    return;
  }
  throw new TargusError(
    'bad_request',
    `${dir} holds a ${platform} capture, not ${target.platform}: check --platform`,
  );
}

async function publishTarget(prepared: PreparedTarget, shared: RunShared): Promise<RunBuildOutput> {
  const { options, deps, target } = { ...shared, target: prepared.target };
  const platformOut =
    options.out === undefined || !shared.several
      ? options.out
      : path.join(options.out, target.kind);
  const dir = await captureDir(prepared, platformOut, options, deps);
  deps.log(`loading capture from ${dir}`);
  const loaded = await loadCapture(dir);
  checkCapturePlatform(target, dir, loaded.platform);
  const device = prepared.device ?? loaded.deviceName;
  if (device === null) throw new TargusError('bad_request', noDeviceName);
  const output = await runBuild({
    report: loaded.report,
    git: shared.git,
    ci: shared.ci,
    device,
    appearance: loaded.appearance,
    platform: loaded.platform,
    pixelRatio: loaded.pixelRatio,
    api: shared.api,
    clock: deps.clock,
    ids: deps.ids,
    compareImages: compareWithCore,
    hash: sha256Hex,
    isBlank: isBlankPng,
    ...(target.kind !== 'dir' && options.filter !== undefined ? { filter: options.filter } : {}),
  });
  for (const line of formatRunSummary(output)) deps.log(line);
  return output;
}

/** Publish each target in turn; a failed platform does not stop the next (ADR 0038). */
async function publishAll(
  prepared: readonly PreparedTarget[],
  shared: RunShared,
): Promise<RunBuildOutput[]> {
  const outputs: RunBuildOutput[] = [];
  let firstError: Error | null = null;
  for (const target of prepared) {
    const platform = target.target.kind === 'dir' ? 'capture' : target.target.kind;
    if (shared.several) shared.deps.log(`== ${platform} ==`);
    try {
      outputs.push(await publishTarget(target, shared));
    } catch (error) {
      if (!shared.several) throw error;
      shared.deps.log(
        `${platform} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      firstError ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  if (firstError !== null) throw firstError;
  return outputs;
}

/**
 * `targus run`: for each platform the flags and the targus config select (ADR 0038), capture
 * (or load `--from-capture`), open a build, diff against the baselines locally, upload images and
 * submit the results (plan.md section 4). Everything that can fail cheaply (targets, devices,
 * app, token and project, git, branch) is checked before the minutes-long captures.
 */
export async function runRun(
  options: RunCommandOptions,
  config: CliConfig,
  deps: RunCommandDeps = defaultRunDeps,
): Promise<RunBuildOutput[]> {
  if (config.token === undefined) {
    throw new TargusError('unauthorized', 'TARGUS_TOKEN is not set: export the project token');
  }
  const targets = resolveTargets(options, await deps.loadProjectConfig(options.config));
  const prepared: PreparedTarget[] = [];
  for (const target of targets) prepared.push(await prepareTarget(target, deps));
  const api = deps.createApi(options.apiUrl, config.token, deps.log);
  await checkProject(api, options.apiUrl, deps.log);
  const git = deps.createGit(deps.exec);
  const gitInfo = await readGitInfo(git, options.baseBranch, options.sha, deps.log);
  const ci = await resolveContext(options, config, git);
  return publishAll(prepared, {
    options,
    deps,
    api,
    git: gitInfo,
    ci,
    several: prepared.length > 1,
  });
}
