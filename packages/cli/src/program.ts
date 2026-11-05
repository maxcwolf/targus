import { isTargusError, type TargusErrorCode } from '@targus/core';
import { Command, InvalidArgumentError } from 'commander';

import { runCapture, type CaptureCommandOptions } from './commands/capture.js';
import { runCompare, type CompareCommandOptions } from './commands/compare.js';
import type { CliConfig } from './config.js';
import { cliVersion } from './version.js';

/** Exit code for commands that exist in the CLI surface but are not built yet. */
export const notImplementedExitCode = 2;

/** Process exit code for each TargusError code the CLI reports; any other code exits 1. */
const exitCodes: Partial<Record<TargusErrorCode, number>> = {
  not_implemented: notImplementedExitCode,
};

export function exitCodeFor(code: TargusErrorCode): number {
  return exitCodes[code] ?? 1;
}

/** What each command does once its options are parsed. Tests swap these out. */
export interface CommandRunners {
  readonly capture: (options: CaptureCommandOptions) => Promise<unknown>;
  readonly compare: (options: CompareCommandOptions) => Promise<unknown>;
}

const defaultRunners: CommandRunners = {
  capture: (options) => runCapture(options),
  compare: (options) => runCompare(options),
};

export interface ProgramOptions {
  /** Validated environment; the offline commands (capture, compare) do not need it yet. */
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

function ratio(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new InvalidArgumentError('expected a number between 0 and 1');
  }
  return parsed;
}

function addCaptureCommand(program: Command, run: CommandRunners['capture']): void {
  program
    .command('capture')
    .description('Capture every story to a directory with a manifest.json (works offline).')
    .requiredOption('--udid <id>', 'simulator UDID (xcrun simctl list devices)')
    .requiredOption('--app <path>', 'path to the built simulator .app')
    .requiredOption('--out <dir>', 'output directory')
    .option('--bundle-id <id>', 'bundle id (default: read from the app Info.plist)')
    .option('--port <n>', 'Storybook channel port the app connects to', integer, 7007)
    .option('--settle <ms>', 'wait after storyRendered before the first screenshot', integer, 300)
    .option('--stability-gap <ms>', 'gap between the two stability screenshots', integer, 150)
    .option('--render-timeout <ms>', 'how long to wait for storyRendered', integer, 10000)
    .option('--connect-timeout <ms>', 'how long to wait for the app to connect', integer, 60000)
    .option('--attempts <n>', 'stability attempts, settle doubling each time', integer, 3)
    .option('--filter <text>', 'only stories whose id or title contains this text')
    .option('--limit <n>', 'capture at most this many stories', integer)
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
export function createProgram({ runners = {} }: ProgramOptions): Command {
  const program = new Command('targus')
    .description('Visual review for React Native on-device Storybook.')
    .version(cliVersion, '-v, --version');

  addCaptureCommand(program, runners.capture ?? defaultRunners.capture);
  addCompareCommand(program, runners.compare ?? defaultRunners.compare);
  return program;
}
