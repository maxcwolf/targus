import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createFakeClock, createFakeDeviceDriver, type FakeDeviceDriver } from '@targus/core';
import { CommanderError } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import type { Exec } from './adapters/exec.adapter.ts';
import type { GitMetadata } from './adapters/git.adapter.ts';
import { WsStorybookChannel } from './adapters/ws-channel.adapter.ts';
import { crashReportDir } from './capture/app-watch.ts';
import { encodeSolidPng } from './capture/solid-png.fake.ts';
import { runCapture } from './commands/capture.ts';
import { runRun, type RunCommandDeps } from './commands/run.ts';
import { loadConfig } from './config.ts';
import { failureExitCode } from './errors/exit-codes.ts';
import { createProgram } from './program.ts';
import { createFakeTargusApi, type FakeTargusApi } from './run/targus-api.fake.ts';

/**
 * `targus run` when the app under test crashes, from argv to exit code and stderr: the real
 * command, capture loop and websocket channel, with a fake device and a scripted app.
 */

const git: GitMetadata = {
  fetchBase: () => Promise.resolve(),
  headSha: () => Promise.resolve('a'.repeat(40)),
  currentBranch: () => Promise.resolve('feature/button'),
  isShallow: () => Promise.resolve(false),
  resolveCommit: () => Promise.resolve('b'.repeat(40)),
  mergeBase: () => Promise.resolve('b'.repeat(40)),
  firstParentAncestors: () => Promise.resolve([]),
};

const entries = Object.fromEntries(
  ['a--one', 'b--two', 'c--three'].map((id) => [id, { type: 'story', id, title: id, name: id }]),
);

/** What the app does once launched, given the port the CLI listens on. */
type AppScript = (port: number) => void;

let dir: string;
let api: FakeTargusApi;
let driver: FakeDeviceDriver;
let lines: string[];
let sockets: WebSocket[];

function deps(app: AppScript): RunCommandDeps {
  const exec: Exec = () => Promise.reject(new Error('no exec in tests'));
  const log = (line: string) => lines.push(line);
  let port = 0;
  const launch = driver.launch.bind(driver);
  driver.launch = async (bundleId, env) => {
    await launch(bundleId, env);
    app(port);
  };
  return {
    exec,
    clock: createFakeClock(),
    log,
    capture: (options) =>
      runCapture(options, {
        exec,
        clock: createFakeClock(),
        sleep: () => Promise.resolve(),
        log,
        openChannel: async (_port, connectTimeoutMs) => {
          const channel = await WsStorybookChannel.listen({ port: 0, connectTimeoutMs });
          port = channel.port;
          return channel;
        },
        createDriver: () => driver,
        appPollMs: 10,
      }),
    makeTempDir: () => Promise.resolve(path.join(dir, 'tmp-capture')),
    createApi: () => api,
    createGit: () => git,
    simulatorName: () => Promise.resolve('iPhone 16'),
  };
}

async function targus(runDeps: RunCommandDeps): Promise<{ exitCode: number; stderr: string }> {
  let stderr = '';
  const program = createProgram({
    loadConfig: () => loadConfig({ TARGUS_API_URL: 'https://targus.test', TARGUS_TOKEN: 't' }),
    debug: false,
    runners: { run: (options, config) => runRun(options, config, runDeps) },
  });
  for (const command of [program, ...program.commands]) {
    command.exitOverride().configureOutput({
      writeOut: () => undefined,
      writeErr: (text) => (stderr += text),
    });
  }
  // A connect timeout far longer than the test: only the crash check can end these runs.
  const args = ['run', '--udid', 'SIM', '--app', path.join(dir, 'A.app'), '--bundle-id'];
  const flags = ['co.example', '--device-name', 'X', '--connect-timeout', '600000'];
  try {
    await program.parseAsync([...args, ...flags], { from: 'user' });
    return { exitCode: 0, stderr };
  } catch (error) {
    if (error instanceof CommanderError) return { exitCode: error.exitCode, stderr };
    throw error;
  }
}

/** An app that serves the index and renders each story, but dies when asked for `crashOn`. */
function scriptedApp(crashOn: string | null): AppScript {
  return (port) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(socket);
    const send = (type: string, ...args: unknown[]) => {
      socket.send(JSON.stringify({ type, args }));
    };
    socket.on('message', (data: Buffer) => {
      const { type, args } = JSON.parse(data.toString('utf8')) as AppEvent;
      if (type === 'RN_GET_INDEX') send('RN_GET_INDEX_RESPONSE', { index: { entries } });
      if (type !== 'setCurrentStory') return;
      const storyId = args[0]?.storyId;
      if (storyId !== crashOn) {
        send('storyRendered', storyId);
        return;
      }
      driver.exitApp();
      socket.terminate();
    });
  };
}

interface AppEvent {
  readonly type: string;
  readonly args: readonly ({ readonly storyId?: string } | undefined)[];
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'targus-run-crash-'));
  api = createFakeTargusApi();
  driver = createFakeDeviceDriver();
  driver.queueScreenshots(encodeSolidPng(2, 2, [255, 255, 255, 255]));
  lines = [];
  sockets = [];
});

afterEach(async () => {
  for (const socket of sockets) socket.terminate();
  await rm(dir, { recursive: true, force: true });
});

describe('targus run when the app crashes', () => {
  it('exits 1 within moments of a crash at launch, naming the app and the crash reports', async () => {
    const { exitCode, stderr } = await targus(
      deps(() => {
        driver.exitApp();
      }),
    );

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toBe(
      'error: the app co.example exited before any story was captured, probably a crash at ' +
        `launch: look for its crash report in ${crashReportDir}\n`,
    );
    expect(api.calls).toEqual([]);
  });

  it('exits 1 as soon as the app dies mid-run, saying how far it got', async () => {
    const { exitCode, stderr } = await targus(deps(scriptedApp('b--two')));

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toBe(
      'error: the app co.example exited after 1 of 3 stories, probably a crash: look for its ' +
        `crash report in ${crashReportDir}; the partial capture was discarded\n`,
    );
    expect(lines.filter((line) => /^\d\/3 /.test(line))).toEqual([
      '1/3 a--one render=0ms total=0ms',
    ]);
    expect(api.calls).toEqual([]);
  });

  it('runs to the end when the app stays up', async () => {
    const { exitCode, stderr } = await targus(deps(scriptedApp(null)));

    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(lines.filter((line) => /^\d\/3 /.test(line))).toHaveLength(3);
    expect(api.callsOf('submitResults')).toHaveLength(1);
  });
});
