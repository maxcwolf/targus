import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createFakeClock,
  createFakeDeviceDriver,
  CreateBuildRequest,
  SubmitResultsRequest,
  type FakeDeviceDriver,
} from '@targus/core';
import { CommanderError } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TargusApiClient, type Fetch } from './adapters/api-client.adapter.ts';
import type { Exec } from './adapters/exec.adapter.ts';
import type { GitMetadata } from './adapters/git.adapter.ts';
import { WsStorybookChannel } from './adapters/ws-channel.adapter.ts';
import { runCapture } from './commands/capture.ts';
import { runRun, type RunCommandDeps } from './commands/run.ts';
import { loadConfig } from './config.ts';
import { failureExitCode } from './errors/exit-codes.ts';
import { writeFixtureCapture } from './fixtures/fixture-capture.ts';
import { createProgram } from './program.ts';
import { createFakeTargusApi, type FakeTargusApi } from './run/targus-api.fake.ts';

/**
 * Whole-run failures of `targus run`, from argv to exit code and stderr: the real command, the
 * real capture loop and API client, with fakes only at the edges (git, the device, `fetch`).
 */

const head = 'a'.repeat(40);
const mergeBase = 'b'.repeat(40);

const git: GitMetadata = {
  fetchBase: () => Promise.resolve(),
  headSha: () => Promise.resolve(head),
  currentBranch: () => Promise.resolve('feature/button'),
  isShallow: () => Promise.resolve(false),
  resolveCommit: (ref) => Promise.resolve(ref === 'origin/main' ? mergeBase : null),
  mergeBase: () => Promise.resolve(mergeBase),
  firstParentAncestors: () => Promise.resolve([]),
};

/** Answers a request itself instead of the fake server, or `null` to let the server answer. */
type Override = (method: string, pathname: string) => Response | null;

type Route = (api: FakeTargusApi, pathname: string, body: RequestInit['body']) => Promise<unknown>;

function json(body: RequestInit['body']): unknown {
  return typeof body === 'string' ? (JSON.parse(body) as unknown) : null;
}

/** The fake server's routes, by method and path pattern; a capture group is the id. */
const routes: readonly (readonly [string, RegExp, Route])[] = [
  [
    'POST',
    /^\/api\/builds$/,
    (api, _id, body) => api.createBuild(CreateBuildRequest.parse(json(body))),
  ],
  [
    'PUT',
    /^\/api\/images\/(\w+)$/,
    (api, hash, body) =>
      api.uploadImage(hash, body instanceof Uint8Array ? body : new Uint8Array()),
  ],
  [
    'POST',
    /^\/api\/builds\/([^/]+)\/results$/,
    (api, build, body) => api.submitResults(build, SubmitResultsRequest.parse(json(body))),
  ],
];

/** An HTTP front for the in-memory API, so the real `TargusApiClient` talks to it. */
function serve(api: FakeTargusApi, override: Override): Fetch {
  return async (url, init) => {
    const { pathname } = new URL(url);
    const method = init.method ?? 'GET';
    const answer = override(method, pathname);
    if (answer !== null) return answer;
    for (const [routeMethod, pattern, handle] of routes) {
      const match = pattern.exec(pathname);
      if (routeMethod === method && match !== null) {
        return Response.json(await handle(api, match[1] ?? '', init.body));
      }
    }
    return new Response('no such route', { status: 404 });
  };
}

let dir: string;
let api: FakeTargusApi;
let driver: FakeDeviceDriver;
let lines: string[];
let waits: number[];

function deps(override: Override = () => null): RunCommandDeps {
  const exec: Exec = () => Promise.reject(new Error('no exec in tests'));
  const log = (line: string) => lines.push(line);
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
        // Any free port: nothing will connect to it, like an app that never started.
        openChannel: (_port, connectTimeoutMs) =>
          WsStorybookChannel.listen({ port: 0, connectTimeoutMs }),
        createDriver: () => driver,
      }),
    makeTempDir: () => Promise.resolve(path.join(dir, 'tmp-capture')),
    createApi: (baseUrl, token, onRetry) =>
      new TargusApiClient({
        baseUrl,
        token,
        fetch: serve(api, override),
        onRetry,
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      }),
    createGit: () => git,
    simulatorName: () => Promise.resolve('iPhone 16'),
  };
}

interface Outcome {
  readonly exitCode: number;
  readonly stderr: string;
}

async function targus(args: string[], runDeps: RunCommandDeps): Promise<Outcome> {
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
  try {
    await program.parseAsync(args, { from: 'user' });
    return { exitCode: 0, stderr };
  } catch (error) {
    if (error instanceof CommanderError) return { exitCode: error.exitCode, stderr };
    throw error;
  }
}

async function fromCapture(override?: Override): Promise<Outcome> {
  const capture = path.join(dir, 'capture');
  await writeFixtureCapture(capture);
  const args = ['run', '--from-capture', capture, '--device-name', 'iPhone 16'];
  return targus(args, deps(override));
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'targus-run-failures-'));
  api = createFakeTargusApi();
  driver = createFakeDeviceDriver();
  lines = [];
  waits = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('targus run when the app never connects', () => {
  it('exits 1 after --connect-timeout, says what to check, and opens no build', async () => {
    const args = ['run', '--udid', 'SIM', '--app', path.join(dir, 'A.app')];
    const flags = ['--bundle-id', 'co.example', '--device-name', 'X', '--connect-timeout', '20'];

    const { exitCode, stderr } = await targus([...args, ...flags], deps());

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toMatch(/^error: the app did not connect within 20ms on port \d+: check/);
    expect(stderr).toContain('EXPO_PUBLIC_TARGUS=true');
    expect(stderr).toContain('raise --connect-timeout');
    expect(driver.calls).toContainEqual({ method: 'launch', bundleId: 'co.example', env: {} });
    expect(api.calls).toEqual([]);
  });
});

describe('targus run when an upload fails', () => {
  const failUploads: Override = (method) =>
    method === 'PUT' ? new Response('bucket unavailable', { status: 503 }) : null;

  it('retries, then exits 1 naming the image and never submits', async () => {
    const { exitCode, stderr } = await fromCapture(failUploads);

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toMatch(
      /^error: PUT \/api\/images\/\w{64} failed with 503: bucket unavailable \(gave up after 4 attempts\)\n$/,
    );
    expect(waits).toEqual([500, 1000, 2000]);
    expect(lines.filter((line) => line.startsWith('warning: PUT'))).toHaveLength(3);
    expect(api.callsOf('submitResults')).toEqual([]);
  });

  it('rides out one flaky upload and publishes the build', async () => {
    let failed = false;
    const flaky: Override = (method) => {
      if (method !== 'PUT' || failed) return null;
      failed = true;
      return new Response('', { status: 502, statusText: 'Bad Gateway' });
    };

    const { exitCode } = await fromCapture(flaky);

    expect(exitCode).toBe(0);
    expect(lines).toContainEqual(
      expect.stringMatching(/^warning: PUT .* 502: Bad Gateway; retrying/),
    );
    expect(api.callsOf('uploadImage')).toHaveLength(3);
    expect(api.callsOf('submitResults')).toHaveLength(1);
  });

  it('does not retry an upload the server rejects', async () => {
    const tooLarge: Override = (method) =>
      method === 'PUT'
        ? Response.json({ error: { message: 'image too large' } }, { status: 413 })
        : null;

    const { exitCode, stderr } = await fromCapture(tooLarge);

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toMatch(/failed with 413: image too large\n$/);
    expect(waits).toEqual([]);
  });
});

describe('targus run when submitting results fails', () => {
  it('retries, then exits 1 naming the request', async () => {
    const down: Override = (method, pathname) =>
      method === 'POST' && pathname.endsWith('/results')
        ? Response.json(
            {
              error: {
                code: 'internal',
                message: 'database unavailable',
                requestId: 'req-of-the-last-try',
              },
            },
            { status: 500 },
          )
        : null;

    const { exitCode, stderr } = await fromCapture(down);

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toBe(
      'error: POST /api/builds/build-1/results failed with 500: database unavailable ' +
        '(gave up after 4 attempts) (request id: req-of-the-last-try)\n',
    );
    expect(api.callsOf('uploadImage')).toHaveLength(3);
  });

  it('says an earlier attempt may have landed when a retry meets a 409', async () => {
    let tries = 0;
    const lostResponse: Override = (method, pathname) => {
      if (method !== 'POST' || !pathname.endsWith('/results')) return null;
      tries += 1;
      return tries === 1
        ? new Response('', { status: 504, statusText: 'Gateway Timeout' })
        : Response.json(
            { error: { message: 'build build-1 already has results' } },
            { status: 409 },
          );
    };

    const { exitCode, stderr } = await fromCapture(lostResponse);

    expect(exitCode).toBe(failureExitCode);
    expect(stderr).toContain('409: build build-1 already has results');
    expect(stderr).toContain('an earlier attempt may have succeeded before its response was lost');
  });
});
