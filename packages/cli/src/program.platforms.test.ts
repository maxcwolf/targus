import { CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';

import type { CaptureCommandOptions } from './commands/capture.ts';
import type { WebCaptureOptions } from './commands/capture-web.ts';
import type { RunCommandOptions } from './commands/run.ts';
import { loadConfig } from './config.ts';
import { createProgram } from './program.ts';
import type { ProjectConfig } from './project-config.ts';

interface Parsed {
  readonly output: string;
  readonly error: CommanderError | undefined;
  readonly native: CaptureCommandOptions[];
  readonly web: WebCaptureOptions[];
  readonly runs: RunCommandOptions[];
  readonly configs: (string | undefined)[];
}

async function parse(args: string[], project: ProjectConfig | null = null): Promise<Parsed> {
  let output = '';
  const parsed: Omit<Parsed, 'output' | 'error'> = {
    native: [],
    web: [],
    runs: [],
    configs: [],
  };
  const program = createProgram({
    loadConfig: (overrides) => loadConfig({ TARGUS_TOKEN: 't' }, overrides),
    loadProjectConfig: (file) => {
      parsed.configs.push(file);
      return Promise.resolve(project);
    },
    debug: false,
    runners: {
      capture: (options) => Promise.resolve(parsed.native.push(options)),
      captureWeb: (options) => Promise.resolve(parsed.web.push(options)),
      run: (options) => Promise.resolve(parsed.runs.push(options)),
    },
  });
  const sink = { writeOut: (t: string) => (output += t), writeErr: (t: string) => (output += t) };
  for (const command of [program, ...program.commands]) {
    command.exitOverride().configureOutput(sink);
  }
  try {
    await program.parseAsync(args, { from: 'user' });
    return { output, error: undefined, ...parsed };
  } catch (error) {
    if (error instanceof CommanderError) return { output, error, ...parsed };
    throw error;
  }
}

const tuning = { settle: 300, stabilityGap: 150, renderTimeout: 10000, attempts: 3 };

describe('targus capture --platform web', () => {
  it('captures a Storybook with the web defaults', async () => {
    const { web, native, error } = await parse([
      'capture',
      '--platform',
      'web',
      '--storybook',
      'storybook-static',
      '--out',
      'out',
    ]);
    expect(error).toBeUndefined();
    expect(native).toEqual([]);
    expect(web).toEqual([
      {
        ...tuning,
        out: 'out',
        storybook: 'storybook-static',
        viewport: { width: 1200, height: 900 },
        pixelRatio: 1,
      },
    ]);
  });
});

describe('targus capture web flags', () => {
  it('parses --viewport, --pixel-ratio, --filter, --limit and --config', async () => {
    const { web, configs } = await parse(
      [
        'capture',
        '--config',
        'ci/targus.json',
        '--storybook',
        'http://localhost:6006',
        '--viewport',
        '390x844',
        '--pixel-ratio',
        '2',
        '--filter',
        'button',
        '--limit',
        '3',
        '--out',
        'out',
      ],
      { platforms: { web: {} } },
    );
    expect(configs).toEqual(['ci/targus.json']);
    expect(web[0]).toMatchObject({
      storybook: 'http://localhost:6006',
      viewport: { width: 390, height: 844 },
      pixelRatio: 2,
      filter: 'button',
      limit: 3,
    });
  });
});

describe('targus capture flag errors', () => {
  it('refuses a bad viewport, pixel ratio or platform', async () => {
    for (const [flag, value, message] of [
      ['--viewport', 'wide', 'expected WIDTHxHEIGHT'],
      ['--pixel-ratio', '9', 'expected a number above 0, at most 4'],
      ['--platform', 'android', 'not android'],
    ] as const) {
      const { error, output } = await parse(['capture', flag, value, '--out', 'out']);
      expect(error?.exitCode).toBe(1);
      expect(output).toContain(message);
    }
  });
});

describe('targus capture with a config', () => {
  it('takes the iOS app, simulator and appearance from the config', async () => {
    const { native } = await parse(['capture', '--out', 'out', '--bundle-id', 'co.x'], {
      platforms: { ios: { app: '/repo/App.app', udid: 'SIM', appearance: 'dark' } },
    });
    expect(native).toEqual([
      {
        ...tuning,
        out: 'out',
        udid: 'SIM',
        app: '/repo/App.app',
        appearance: 'dark',
        port: 7007,
        connectTimeout: 60000,
        bundleId: 'co.x',
      },
    ]);
  });

  it('needs --platform when the config names both', async () => {
    const { error, output } = await parse(['capture', '--out', 'out'], {
      platforms: { ios: { app: 'A.app', udid: 'SIM' }, web: { storybook: 'sb' } },
    });
    expect(error?.exitCode).toBe(1);
    expect(output).toContain('`targus capture` captures one platform');
  });
});

describe('targus run platform flags', () => {
  it('passes --platform as platforms, with the web flags', async () => {
    const { runs } = await parse([
      'run',
      '--platform',
      'web,ios',
      '--storybook',
      'sb',
      '--viewport',
      '800x600',
      '--pixel-ratio',
      '1.5',
      '--config',
      'targus.json',
    ]);
    expect(runs[0]).toMatchObject({
      platforms: ['ios', 'web'],
      storybook: 'sb',
      viewport: { width: 800, height: 600 },
      pixelRatio: 1.5,
      config: 'targus.json',
    });
    expect(runs[0]).not.toHaveProperty('platform');
  });
});
