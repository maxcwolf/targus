import { GitSha, isTargusError, type TargusErrorCode } from '@targus/core';
import { Command, InvalidArgumentError } from 'commander';

import { runCapture, type CaptureCommandOptions } from './commands/capture.js';
import { runCompare, type CompareCommandOptions } from './commands/compare.js';
import { runRun, type RunCommandOptions } from './commands/run.js';
import type { CliConfig } from './config.js';
import { writeFixtureCapture } from './fixtures/fixture-capture.js';
import { cliVersion } from './version.js';

/** Exit code for commands that exist in the CLI surface but are not built yet. */
export const notImplementedExitCode = 2;

/** Exit code when the API rejects the project token (missing, wrong or not allowed). */
export const unauthorizedExitCode = 3;

/** Process exit code for each TargusError code the CLI reports; any other code exits 1. */
const exitCodes: Partial<Record<TargusErrorCode, number>> = {
  not_implemented: notImplementedExitCode,
  unauthorized: unauthorizedExitCode,
  forbidden: unauthorizedExitCode,
};

export function exitCodeFor(code: TargusErrorCode): number {
  return exitCodes[code] ?? 1;
}

/** What each command does once its options are parsed. Tests swap these out. */
export interface CommandRunners {
  readonly capture: (options: CaptureCommandOptions) => Promise<unknown>;
  readonly compare: (options: CompareCommandOptions) => Promise<unknown>;
  readonly run: (options: RunCommandOptions, config: CliConfig) => Promise<unknown>;
  readonly fixtureCapture: (dir: string) => Promise<unknown>;
}

const defaultRunners: CommandRunners = {
  capture: (options) => runCapture(options),
  compare: (options) => runCompare(options),
  run: (options, config) => runRun(options, config),
  fixtureCapture: (dir) => writeFixtureCapture(dir),
};

export interface ProgramOptions {
  /** Validated environment: `run` reads the API URL, the token and the CI variables from it. */
  readonly config: CliConfig;
  readonly runners?: Partial<CommandRunners>;
}

/** Commands throw TargusError; this reports it on stderr and exits with the mapped code. */
function reportTargusErrors<T>(
  program: Command,
  action: (options: T) => Promise<unknown>,
): (options: T) => Promise<void> {
  return async (options) => {
    try {
      await action(options);
    } catch (error) {
      if (!isTargusError(error)) throw error;
      program.error(error.message, {
        exitCode: exitCodeFor(error.code),
        code: `targus.${error.code}`,
      });
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

/** The capture tuning flags `capture` and `run` share. */
function addCaptureFlags(command: Command): Command {
  return command
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

function addCaptureCommand(program: Command, run: CommandRunners['capture']): void {
  const command = program
    .command('capture')
    .description('Capture every story to a directory with a manifest.json (works offline).')
    .requiredOption('--udid <id>', 'simulator UDID (xcrun simctl list devices)')
    .requiredOption('--app <path>', 'path to the built simulator .app')
    .requiredOption('--out <dir>', 'output directory');
  addCaptureFlags(command).action(reportTargusErrors(program, run));
}

function addRunCommand(program: Command, config: CliConfig, run: CommandRunners['run']): void {
  const command = program
    .command('run')
    .description('Capture, diff against the baselines and publish a build (what CI calls).')
    .option('--udid <id>', 'simulator UDID (not needed with --from-capture)')
    .option('--app <path>', 'path to the built simulator .app (not needed with --from-capture)')
    .option('--out <dir>', 'where to write the capture (default: a temp directory)')
    .option('--from-capture <dir>', 'skip the simulator and use a `targus capture` directory')
    .option('--api-url <url>', 'targus API (env TARGUS_API_URL)', config.apiUrl)
    .option('--device-name <name>', 'device the build is for (default: the simulator name)')
    .option('--base-branch <branch>', 'default branch; a build on it without a PR is main', 'main')
    .option('--branch <name>', 'branch (default: from CI env, then git)')
    .option('--pr <n>', 'pull request number (default: from CI env)', positiveInteger)
    .option('--sha <sha>', 'commit of the build (default: git rev-parse HEAD)', gitSha)
    .option('--threshold <ratio>', 'changed-pixel ratio above which a story changed', ratio, 0.001);
  addCaptureFlags(command).action(
    reportTargusErrors(program, (options: RunCommandOptions) => run(options, config)),
  );
}

function addFixtureCommand(program: Command, run: CommandRunners['fixtureCapture']): void {
  program
    .command('fixture-capture', { hidden: true })
    .description('Write a tiny three-story capture directory for tests and the e2e suite.')
    .argument('<dir>', 'output directory')
    .action(reportTargusErrors(program, run));
}

function addCompareCommand(program: Command, run: CommandRunners['compare']): void {
  program
    .command('compare')
    .description('Diff a capture against a baseline capture and write an HTML report.')
    .requiredOption('--current <dir>', 'capture directory to check')
    .requiredOption('--baseline <dir>', 'capture directory to compare against')
    .requiredOption('--out <dir>', 'report directory')
    .option('--threshold <ratio>', 'changed-pixel ratio above which a story changed', ratio, 0.001)
    .action(reportTargusErrors(program, run));
}

/** Build the `targus` command tree. `bin.ts` parses process.argv with it. */
export function createProgram({ config, runners = {} }: ProgramOptions): Command {
  const program = new Command('targus')
    .description('Visual review for React Native on-device Storybook.')
    .version(cliVersion, '-v, --version');

  addCaptureCommand(program, runners.capture ?? defaultRunners.capture);
  addCompareCommand(program, runners.compare ?? defaultRunners.compare);
  addRunCommand(program, config, runners.run ?? defaultRunners.run);
  addFixtureCommand(program, runners.fixtureCapture ?? defaultRunners.fixtureCapture);
  return program;
}
