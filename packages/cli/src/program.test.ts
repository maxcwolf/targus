import { TargusError } from '@targus/core';
import { CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';

import type { CaptureCommandOptions } from './commands/capture.js';
import type { CompareCommandOptions } from './commands/compare.js';
import { loadConfig, simulatorTestTarget } from './config.js';
import {
  createProgram,
  exitCodeFor,
  notImplementedExitCode,
  unauthorizedExitCode,
  type CommandRunners,
} from './program.js';
import { cliVersion } from './version.js';

interface RunResult {
  readonly output: string;
  readonly error: CommanderError | undefined;
  readonly captured: CaptureCommandOptions[];
  readonly compared: CompareCommandOptions[];
}

async function run(args: string[], runners: Partial<CommandRunners> = {}): Promise<RunResult> {
  let output = '';
  const captured: CaptureCommandOptions[] = [];
  const compared: CompareCommandOptions[] = [];
  const capture = {
    writeOut: (text: string) => (output += text),
    writeErr: (text: string) => (output += text),
  };
  const program = createProgram({
    config: loadConfig({}),
    runners: {
      capture: (options) => Promise.resolve(captured.push(options)),
      compare: (options) => Promise.resolve(compared.push(options)),
      ...runners,
    },
  });
  // Subcommands copy output settings when they are created, so configure each one.
  for (const command of [program, ...program.commands]) {
    command.exitOverride().configureOutput(capture);
  }

  try {
    await program.parseAsync(args, { from: 'user' });
    return { output, error: undefined, captured, compared };
  } catch (error) {
    if (error instanceof CommanderError) return { output, error, captured, compared };
    throw error;
  }
}

const captureArgs = ['capture', '--udid', 'SIM', '--app', 'build/ExampleApp.app', '--out', 'out'];

describe('targus program', () => {
  it('prints the package version for --version', async () => {
    const { output, error } = await run(['--version']);

    expect(output.trim()).toBe(cliVersion);
    expect(error?.code).toBe('commander.version');
  });

  it('parses capture options with their defaults', async () => {
    const { captured, error } = await run(captureArgs);

    expect(error).toBeUndefined();
    expect(captured).toEqual([
      {
        udid: 'SIM',
        app: 'build/ExampleApp.app',
        out: 'out',
        port: 7007,
        settle: 300,
        stabilityGap: 150,
        renderTimeout: 10000,
        connectTimeout: 60000,
        attempts: 3,
      },
    ]);
  });
});

describe('targus capture options', () => {
  it('parses every capture flag', async () => {
    const { captured } = await run([
      ...captureArgs,
      '--bundle-id',
      'co.example',
      '--port',
      '7100',
      '--settle',
      '500',
      '--limit',
      '5',
      '--filter',
      'button',
    ]);

    expect(captured[0]).toMatchObject({
      bundleId: 'co.example',
      port: 7100,
      settle: 500,
      limit: 5,
      filter: 'button',
    });
  });

  it('rejects a non-integer number option', async () => {
    const { error, output } = await run([...captureArgs, '--limit', 'five']);

    expect(error?.code).toBe('commander.invalidArgument');
    expect(output).toContain('non-negative integer');
  });
});

describe('targus program validation', () => {
  it('requires --udid, --app and --out for capture', async () => {
    const { error } = await run(['capture']);

    expect(error?.code).toBe('commander.missingMandatoryOptionValue');
    expect(error?.exitCode).toBe(1);
  });

  it('parses compare options and validates the threshold', async () => {
    const base = ['compare', '--current', 'c', '--baseline', 'b', '--out', 'r'];

    expect((await run(base)).compared).toEqual([
      { current: 'c', baseline: 'b', out: 'r', threshold: 0.001 },
    ]);
    expect((await run([...base, '--threshold', '0.05'])).compared[0]?.threshold).toBe(0.05);
    expect((await run([...base, '--threshold', '2'])).error?.code).toBe(
      'commander.invalidArgument',
    );
  });

  it('maps a TargusError from a command to its exit code', async () => {
    const { output, error } = await run(captureArgs, {
      capture: () => Promise.reject(new TargusError('not_implemented', 'not implemented yet')),
    });

    expect(output).toContain('not implemented yet');
    expect(error?.exitCode).toBe(notImplementedExitCode);
    expect(error?.code).toBe('targus.not_implemented');
  });

  it('lets other errors propagate', async () => {
    await expect(
      run(captureArgs, { capture: () => Promise.reject(new Error('boom')) }),
    ).rejects.toThrow('boom');
  });
});

describe('exitCodeFor', () => {
  it('maps not_implemented to 2, auth failures to 3 and every other code to 1', () => {
    expect(exitCodeFor('not_implemented')).toBe(notImplementedExitCode);
    expect(exitCodeFor('unauthorized')).toBe(unauthorizedExitCode);
    expect(exitCodeFor('forbidden')).toBe(unauthorizedExitCode);
    expect(unauthorizedExitCode).toBe(3);
    expect(exitCodeFor('internal')).toBe(1);
    expect(exitCodeFor('bad_request')).toBe(1);
  });
});

describe('loadConfig', () => {
  it('applies defaults and reads the token', () => {
    expect(loadConfig({ TARGUS_TOKEN: 'secret' })).toEqual({
      apiUrl: 'http://localhost:8787',
      token: 'secret',
      ci: {},
    });
  });

  it('passes the CI variables through and ignores the rest of the environment', () => {
    expect(
      loadConfig({ CIRCLE_BRANCH: 'main', GITHUB_REF: 'refs/heads/main', HOME: '/home' }).ci,
    ).toEqual({ CIRCLE_BRANCH: 'main', GITHUB_REF: 'refs/heads/main' });
  });

  it('rejects an invalid API URL', () => {
    expect(() => loadConfig({ TARGUS_API_URL: 'not a url' })).toThrow(/TARGUS_API_URL/);
  });
});

describe('simulatorTestTarget', () => {
  it('needs both the UDID and the app', () => {
    expect(simulatorTestTarget({ TARGUS_SIMULATOR_UDID: 'SIM' })).toBeNull();
    expect(simulatorTestTarget({ TARGUS_SIMULATOR_UDID: 'SIM', TARGUS_APP: '/a.app' })).toEqual({
      udid: 'SIM',
      app: '/a.app',
    });
  });
});
