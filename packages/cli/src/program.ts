import { Appearance, defaultThreshold, GitSha, TargusError } from '@targus/core';
import { Command, InvalidArgumentError, Option } from 'commander';

import { runCapture, type CaptureCommandOptions } from './commands/capture.ts';
import { runWebCapture, type WebCaptureOptions } from './commands/capture-web.ts';
import { runCompare, type CompareCommandOptions } from './commands/compare.ts';
import { runRun, type RunCommandOptions } from './commands/run.ts';
import { debugEnabled, loadConfig, type CliConfig, type ConfigOverrides } from './config.ts';
import { describeError } from './errors/describe-error.ts';
import { writeFixtureCapture } from './fixtures/fixture-capture.ts';
import {
  loadProjectConfig,
  parsePlatformList,
  ViewportText,
  type CapturePlatformName,
  type ProjectConfig,
} from './project-config.ts';
import { resolveCaptureTarget, type TargetFlags } from './run/run-targets.ts';
import { cliVersion } from './version.ts';

/** What each command does once its options are parsed. Tests swap these out. */
export interface CommandRunners {
  readonly capture: (options: CaptureCommandOptions) => Promise<unknown>;
  readonly captureWeb: (options: WebCaptureOptions) => Promise<unknown>;
  readonly compare: (options: CompareCommandOptions) => Promise<unknown>;
  readonly run: (options: RunCommandOptions, config: CliConfig) => Promise<unknown>;
  readonly fixtureCapture: (dir: string) => Promise<unknown>;
}

const defaultRunners: CommandRunners = {
  capture: (options) => runCapture(options),
  captureWeb: (options) => runWebCapture(options),
  compare: (options) => runCompare(options),
  run: (options, config) => runRun(options, config),
  fixtureCapture: (dir) => writeFixtureCapture(dir),
};

export interface ProgramOptions {
  /**
   * Reads and validates the environment, with the flags that override it (`--api-url`). Called
   * only when `run` (the one command that needs it) runs, before any device work, so `--help` and
   * `--version` work with no environment at all. Default: `loadConfig()`.
   */
  readonly loadConfig?: (overrides: ConfigOverrides) => CliConfig;
  /** Print stack traces with errors. Default: `TARGUS_DEBUG=1`. */
  readonly debug?: boolean;
  readonly runners?: Partial<CommandRunners>;
  /** Reads `targus.config.ts`, `.json` or `--config` (ADR 0038). Default: `loadProjectConfig`. */
  readonly loadProjectConfig?: (file: string | undefined) => Promise<ProjectConfig | null>;
}

/**
 * `run` options as Commander parses them: `--api-url` is checked by `loadConfig` at run time,
 * and `--threshold` is parsed only to be refused.
 */
type RunFlags = Omit<RunCommandOptions, 'apiUrl' | 'platforms'> & {
  readonly apiUrl?: string;
  readonly threshold?: string;
  /** `--platform`, parsed; renamed to `platforms` for the run. */
  readonly platform?: readonly CapturePlatformName[];
};

/** Report anything a command throws as a few plain lines on stderr and the mapped exit code. */
function reportErrors<T>(
  program: Command,
  debug: boolean,
  action: (options: T) => Promise<unknown>,
): (options: T) => Promise<void> {
  return async (options) => {
    try {
      await action(options);
    } catch (error) {
      const { message, exitCode, code } = describeError(error, { debug });
      program.error(message, { exitCode, code });
    }
  };
}

function integer(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError('expected a non-negative integer');
  }
  return parsed;
}

function positiveInteger(value: string): number {
  const parsed = integer(value);
  if (parsed === 0) throw new InvalidArgumentError('expected a positive integer');
  return parsed;
}

function gitSha(value: string): string {
  const parsed = GitSha.safeParse(value);
  if (!parsed.success) throw new InvalidArgumentError('expected a full 40-character git sha');
  return parsed.data;
}

function ratio(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new InvalidArgumentError('expected a number between 0 and 1');
  }
  return parsed;
}

function positiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 4) {
    throw new InvalidArgumentError('expected a number above 0, at most 4');
  }
  return parsed;
}

function viewport(value: string): { width: number; height: number } {
  const parsed = ViewportText.safeParse(value);
  if (!parsed.success) throw new InvalidArgumentError('expected WIDTHxHEIGHT, e.g. 1200x900');
  return parsed.data;
}

function platformList(value: string): CapturePlatformName[] {
  try {
    return parsePlatformList(value);
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * `--appearance`, a new Option for each command, since Commander keeps state on each one. Its
 * default (light) is applied after the targus config, which may set another.
 */
function appearanceOption(): Option {
  return new Option(
    '--appearance <mode>',
    'simulator light or dark mode, set before launch (default: light)',
  ).choices(Appearance.options);
}

/** The flags that choose platforms and say where each one's app or Storybook is (ADR 0038). */
function addTargetFlags(command: Command): Command {
  return command
    .option(
      '--platform <list>',
      'ios, web or both, e.g. ios,web (default: the config, else ios)',
      platformList,
    )
    .option(
      '--config <path>',
      'project config file (default: targus.config.ts or .json, if present)',
    )
    .option('--storybook <dir|url>', 'web: built Storybook directory, or the URL of one')
    .option('--viewport <WxH>', 'web: browser viewport in CSS pixels (default: 1200x900)', viewport)
    .option('--pixel-ratio <n>', 'web: device pixels per CSS pixel (default: 1)', positiveNumber);
}

/** The capture tuning flags `capture` and `run` share. */
function addCaptureFlags(command: Command): Command {
  return addTargetFlags(command)
    .addOption(appearanceOption())
    .option('--bundle-id <id>', 'bundle id (default: read from the app Info.plist)')
    .option('--port <n>', 'Storybook channel port the app connects to', integer, 7007)
    .option('--settle <ms>', 'wait after storyRendered before the first screenshot', integer, 300)
    .option('--stability-gap <ms>', 'gap between the two stability screenshots', integer, 150)
    .option('--render-timeout <ms>', 'how long to wait for storyRendered', integer, 10000)
    .option('--connect-timeout <ms>', 'how long to wait for the app to connect', integer, 60000)
    .option('--attempts <n>', 'stability attempts, settle doubling each time', integer, 3)
    .option('--filter <text>', 'only stories whose id or title contains this text')
    .option('--limit <n>', 'capture at most this many stories', integer);
}

type Report = <T>(action: (options: T) => Promise<unknown>) => (options: T) => Promise<void>;

/** `capture` options as Commander parses them, before the target is resolved (ADR 0038). */
type CaptureFlagValues = Omit<CaptureCommandOptions, 'udid' | 'app' | 'appearance'> &
  Omit<TargetFlags, 'platforms' | 'fromCapture' | 'deviceName'> & {
    readonly platform?: readonly CapturePlatformName[];
    readonly config?: string;
  };

type LoadProject = (file: string | undefined) => Promise<ProjectConfig | null>;

/** Pick the one platform `capture` runs and hand its options to that platform's runner. */
function captureAction(load: LoadProject, runners: CommandRunners) {
  return async (flags: CaptureFlagValues): Promise<unknown> => {
    const { platform, config, ...rest } = flags;
    const target = resolveCaptureTarget(
      { ...rest, ...(platform === undefined ? {} : { platforms: platform }) },
      await load(config),
    );
    const tuning = {
      out: flags.out,
      settle: flags.settle,
      stabilityGap: flags.stabilityGap,
      renderTimeout: flags.renderTimeout,
      attempts: flags.attempts,
      ...(flags.filter === undefined ? {} : { filter: flags.filter }),
      ...(flags.limit === undefined ? {} : { limit: flags.limit }),
    };
    if (target.kind === 'web') {
      const { storybook, viewport: size, pixelRatio } = target;
      return runners.captureWeb({ ...tuning, storybook, viewport: size, pixelRatio });
    }
    return runners.capture({
      ...tuning,
      udid: target.udid,
      app: target.app,
      appearance: target.appearance,
      port: flags.port,
      connectTimeout: flags.connectTimeout,
      ...(target.bundleId === undefined ? {} : { bundleId: target.bundleId }),
    });
  };
}

function addCaptureCommand(
  program: Command,
  report: Report,
  run: (flags: CaptureFlagValues) => Promise<unknown>,
): void {
  const command = program
    .command('capture')
    .description('Capture every story to a directory with a manifest.json (works offline).')
    .option('--udid <id>', 'ios: simulator UDID (xcrun simctl list devices)')
    .option('--app <path>', 'ios: path to the built simulator .app')
    .requiredOption('--out <dir>', 'output directory');
  addCaptureFlags(command).action(report(run));
}

function runWithConfig(
  load: (overrides: ConfigOverrides) => CliConfig,
  run: CommandRunners['run'],
) {
  return (flags: RunFlags): Promise<unknown> => {
    const { threshold, platform, ...options } = flags;
    if (threshold !== undefined) {
      throw new TargusError(
        'bad_request',
        '`targus run` takes no --threshold: the server owns the diff threshold and sends it ' +
          'with the build. Use --threshold with `targus compare`, which runs offline.',
      );
    }
    const config = load({ apiUrl: options.apiUrl });
    const platforms = platform === undefined ? {} : { platforms: platform };
    return run({ ...options, ...platforms, apiUrl: config.apiUrl }, config);
  };
}

function addRunCommand(
  program: Command,
  report: Report,
  run: (options: RunFlags) => Promise<unknown>,
): void {
  const command = program
    .command('run')
    .description('Capture, diff against the baselines and publish a build (what CI calls).')
    .option('--udid <id>', 'simulator UDID (not needed with --from-capture)')
    .option('--app <path>', 'path to the built simulator .app (not needed with --from-capture)')
    .option('--out <dir>', 'where to write the capture (default: a temp directory)')
    .option('--from-capture <dir>', 'skip the simulator and use a `targus capture` directory')
    .option(
      '--api-url <url>',
      'targus API base URL, http or https (default: env TARGUS_API_URL, else http://localhost:8787)',
    )
    .option('--device-name <name>', 'device the build is for (default: the simulator name)')
    .option('--base-branch <branch>', 'default branch; a build on it without a PR is main', 'main')
    .option('--branch <name>', 'branch (default: from CI env, then git)')
    .option('--pr <n>', 'pull request number (default: from CI env)', positiveInteger)
    .option('--sha <sha>', 'commit of the build (default: git rev-parse HEAD)', gitSha)
    // Refused with a plain message rather than "unknown option": the server owns it (ADR 0028).
    .addOption(new Option('--threshold <ratio>').hideHelp());
  addCaptureFlags(command).action(report(run));
}

function addFixtureCommand(
  program: Command,
  report: Report,
  run: CommandRunners['fixtureCapture'],
): void {
  program
    .command('fixture-capture', { hidden: true })
    .description('Write a tiny three-story capture directory for tests and the e2e suite.')
    .argument('<dir>', 'output directory')
    .action(report(run));
}

function addCompareCommand(program: Command, report: Report, run: CommandRunners['compare']): void {
  program
    .command('compare')
    .description('Diff a capture against a baseline capture and write an HTML report.')
    .requiredOption('--current <dir>', 'capture directory to check')
    .requiredOption('--baseline <dir>', 'capture directory to compare against')
    .requiredOption('--out <dir>', 'report directory')
    .option(
      '--threshold <ratio>',
      'changed-pixel ratio above which a story changed',
      ratio,
      defaultThreshold,
    )
    .action(report(run));
}

/** Build the `targus` command tree. `bin.ts` parses process.argv with it. */
export function createProgram(options: ProgramOptions = {}): Command {
  const { runners = {}, debug = debugEnabled() } = options;
  const program = new Command('targus')
    .description('Visual review for React Native on-device Storybook.')
    .version(cliVersion, '-v, --version');
  const report: Report = (action) => reportErrors(program, debug, action);
  const run = runWithConfig(
    options.loadConfig ?? ((overrides) => loadConfig(undefined, overrides)),
    runners.run ?? defaultRunners.run,
  );

  const allRunners: CommandRunners = { ...defaultRunners, ...runners };
  const loadProject: LoadProject =
    options.loadProjectConfig ??
    ((file) => loadProjectConfig({ cwd: process.cwd(), ...(file === undefined ? {} : { file }) }));
  addCaptureCommand(program, report, captureAction(loadProject, allRunners));
  addCompareCommand(program, report, runners.compare ?? defaultRunners.compare);
  addRunCommand(program, report, run);
  addFixtureCommand(program, report, runners.fixtureCapture ?? defaultRunners.fixtureCapture);
  return program;
}
