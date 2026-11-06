import { TargusError } from '@targus/core';
import { CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';

import type { CaptureCommandOptions } from './commands/capture.ts';
import type { CompareCommandOptions } from './commands/compare.ts';
import { debugEnabled, loadConfig, simulatorTestTarget } from './config.ts';
import { exitCodeFor, notImplementedExitCode, unauthorizedExitCode } from './errors/exit-codes.ts';
import { createProgram, type CommandRunners, type ProgramOptions } from './program.ts';
import { cliVersion } from './version.ts';

interface RunResult {
  readonly output: string;
  readonly error: CommanderError | undefined;
  readonly captured: CaptureCommandOptions[];
  readonly compared: CompareCommandOptions[];
}

async function run(
  args: string[],
  runners: Partial<CommandRunners> = {},
  options: Omit<ProgramOptions, 'runners'> = {},
): Promise<RunResult> {
  let output = '';
  const captured: CaptureCommandOptions[] = [];
  const compared: CompareCommandOptions[] = [];
  const capture = {
    writeOut: (text: string) => (output += text),
    writeErr: (text: string) => (output += text),
  };
  const program = createProgram({
    loadConfig: () => loadConfig({}),
    debug: false,
    ...options,
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
});

describe('targus error output', () => {
  it('reports any other error as a plain message with exit code 1 and no stack trace', async () => {
    const { output, error } = await run(captureArgs, {
      capture: () => Promise.reject(new Error('boom')),
    });

    expect(output).toBe(
      'error: unexpected error: boom\n' +
        '  this is probably a bug in targus; run again with TARGUS_DEBUG=1 for the stack trace\n',
    );
    expect(error?.exitCode).toBe(1);
    expect(error?.code).toBe('targus.unexpected');
  });

  it('adds the stack trace when debug is on', async () => {
    const { output } = await run(
      captureArgs,
      { capture: () => Promise.reject(new Error('boom')) },
      { debug: true },
    );

    expect(output).toContain('error: unexpected error: boom');
    expect(output).toMatch(/Error: boom\n\s+at /);
  });

  it('names a missing file', async () => {
    const missing = Object.assign(new Error('ENOENT: no such file'), {
      code: 'ENOENT',
      syscall: 'open',
      path: '/caps/manifest.json',
    });
    const { output, error } = await run(captureArgs, { capture: () => Promise.reject(missing) });

    expect(output).toBe('error: file or directory not found: /caps/manifest.json\n');
    expect(error?.exitCode).toBe(1);
  });
});

describe('targus without configuration', () => {
  const broken: Omit<ProgramOptions, 'runners'> = {
    loadConfig: () => loadConfig({ TARGUS_API_URL: 'not a url' }),
  };

  it.each([['--help'], ['run', '--help'], ['capture', '--help']])(
    'prints %s help without reading the environment',
    async (...args) => {
      const { output, error } = await run(args, {}, broken);

      expect(error?.code).toBe('commander.helpDisplayed');
      expect(error?.exitCode).toBe(0);
      expect(output).toContain('Usage: targus');
    },
  );

  it('prints the version without reading the environment', async () => {
    const { output, error } = await run(['--version'], {}, broken);

    expect(output.trim()).toBe(cliVersion);
    expect(error?.exitCode).toBe(0);
  });

  it('runs commands that do not need the environment', async () => {
    const { captured, error } = await run(captureArgs, {}, broken);

    expect(error).toBeUndefined();
    expect(captured).toHaveLength(1);
  });

  it('reports an invalid environment only when run needs it', async () => {
    const { output, error } = await run(['run', '--from-capture', 'cap'], {}, broken);

    expect(output).toMatch(/^error: TARGUS_API_URL "not a url" is not a URL\n/);
    expect(output).not.toMatch(/\n\s+at /);
    expect(error?.exitCode).toBe(1);
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

  it('normalises the API URL and lets --api-url replace TARGUS_API_URL unread', () => {
    expect(loadConfig({ TARGUS_API_URL: 'https://targus.example.com/' }).apiUrl).toBe(
      'https://targus.example.com',
    );
    const overridden = loadConfig({ TARGUS_API_URL: 'not a url' }, { apiUrl: 'http://h:1/' });
    expect(overridden.apiUrl).toBe('http://h:1');
    expect(() => loadConfig({}, { apiUrl: 'h' })).toThrow(/^--api-url "h" has no http/);
  });

  it('rejects an empty token as unauthorized, not as a validation dump', () => {
    expect(() => loadConfig({ TARGUS_TOKEN: '' })).toThrow(
      new TargusError('unauthorized', 'TARGUS_TOKEN is empty: export the project token'),
    );
  });
});

describe('debugEnabled', () => {
  it('is on for TARGUS_DEBUG=1 or true and off otherwise', () => {
    expect(debugEnabled({ TARGUS_DEBUG: '1' })).toBe(true);
    expect(debugEnabled({ TARGUS_DEBUG: 'TRUE' })).toBe(true);
    expect(debugEnabled({ TARGUS_DEBUG: '0' })).toBe(false);
    expect(debugEnabled({})).toBe(false);
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
