import { TargusError } from '@targus/core';
import { CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';

import type { RunCommandOptions } from './commands/run.ts';
import { loadConfig, type CliConfig } from './config.ts';
import { unauthorizedExitCode } from './errors/exit-codes.ts';
import { createProgram, type CommandRunners } from './program.ts';

interface Parsed {
  readonly output: string;
  readonly error: CommanderError | undefined;
  readonly runs: { options: RunCommandOptions; config: CliConfig }[];
  readonly fixtures: string[];
}

async function parse(
  args: string[],
  runners: Partial<CommandRunners> = {},
  env: Record<string, string> = { TARGUS_API_URL: 'https://targus.example', TARGUS_TOKEN: 't' },
): Promise<Parsed> {
  let output = '';
  const runs: Parsed['runs'] = [];
  const fixtures: string[] = [];
  const program = createProgram({
    loadConfig: (overrides) => loadConfig(env, overrides),
    debug: false,
    runners: {
      run: (options, runConfig) => Promise.resolve(runs.push({ options, config: runConfig })),
      fixtureCapture: (dir) => Promise.resolve(fixtures.push(dir)),
      ...runners,
    },
  });
  const capture = {
    writeOut: (t: string) => (output += t),
    writeErr: (t: string) => (output += t),
  };
  for (const command of [program, ...program.commands]) {
    command.exitOverride().configureOutput(capture);
  }
  try {
    await program.parseAsync(args, { from: 'user' });
    return { output, error: undefined, runs, fixtures };
  } catch (error) {
    if (error instanceof CommanderError) return { output, error, runs, fixtures };
    throw error;
  }
}

describe('targus run options', () => {
  it('defaults the API URL from the environment and the rest from the plan', async () => {
    const { runs, error } = await parse(['run', '--from-capture', 'cap']);

    expect(error).toBeUndefined();
    expect(runs[0]?.options).toEqual({
      fromCapture: 'cap',
      apiUrl: 'https://targus.example',
      baseBranch: 'main',
      threshold: 0.001,
      port: 7007,
      settle: 300,
      stabilityGap: 150,
      renderTimeout: 10000,
      connectTimeout: 60000,
      attempts: 3,
    });
    expect(runs[0]?.config.token).toBe('t');
  });
});

describe('targus run flags', () => {
  it('parses every run flag', async () => {
    const { runs } = await parse([
      'run',
      '--udid',
      'SIM',
      '--app',
      'A.app',
      '--out',
      'o',
      '--api-url',
      'http://localhost:9999',
      '--device-name',
      'iPhone 16',
      '--base-branch',
      'develop',
      '--branch',
      'feature/x',
      '--pr',
      '12',
      '--sha',
      'f'.repeat(40),
      '--threshold',
      '0.01',
      '--limit',
      '4',
    ]);

    expect(runs[0]?.options).toMatchObject({
      udid: 'SIM',
      app: 'A.app',
      out: 'o',
      apiUrl: 'http://localhost:9999',
      deviceName: 'iPhone 16',
      baseBranch: 'develop',
      branch: 'feature/x',
      pr: 12,
      sha: 'f'.repeat(40),
      threshold: 0.01,
      limit: 4,
    });
  });
});

describe('targus run validation', () => {
  it('has no token flag', async () => {
    const { error } = await parse(['run', '--token', 'secret']);

    expect(error?.code).toBe('commander.unknownOption');
  });

  it('rejects a zero PR number', async () => {
    const { error, output } = await parse(['run', '--pr', '0']);

    expect(error?.code).toBe('commander.invalidArgument');
    expect(output).toContain('positive integer');
  });

  it('rejects a sha that is not a full lowercase 40-character sha', async () => {
    for (const sha of ['abc123', 'F'.repeat(40), 'g'.repeat(40)]) {
      const { error, output, runs } = await parse(['run', '--sha', sha]);

      expect(error?.code).toBe('commander.invalidArgument');
      expect(output).toContain('40-character git sha');
      expect(runs).toEqual([]);
    }
  });

  it('exits 3 when the API rejects the token', async () => {
    const { error, output } = await parse(['run', '--from-capture', 'c'], {
      run: () =>
        Promise.reject(new TargusError('unauthorized', 'POST /api/builds failed with 401')),
    });

    expect(error?.exitCode).toBe(unauthorizedExitCode);
    expect(output).toContain('401');
  });
});

describe('targus fixture-capture', () => {
  it('is hidden from help and takes the output directory', async () => {
    const { fixtures } = await parse(['fixture-capture', '/tmp/fixture']);
    const help = await parse(['--help']);

    expect(fixtures).toEqual(['/tmp/fixture']);
    expect(help.output).toContain('run [options]');
    expect(help.output).not.toContain('fixture-capture');
  });
});
