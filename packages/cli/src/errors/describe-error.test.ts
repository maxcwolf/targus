import { TargusError } from '@targus/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { TargusApiClient } from '../adapters/api-client.adapter.ts';
import { ExecError } from '../adapters/exec.adapter.ts';
import { describeError } from './describe-error.ts';

function systemError(message: string, fields: Record<string, unknown>): Error {
  return Object.assign(new Error(message), fields);
}

const refused = systemError('connect ECONNREFUSED 127.0.0.1:8787', {
  code: 'ECONNREFUSED',
  syscall: 'connect',
  address: '127.0.0.1',
  port: 8787,
});

const describeQuietly = (error: unknown) => describeError(error, { debug: false });

describe('describeError for TargusError', () => {
  it('prints the message and maps the code to the exit code', () => {
    expect(describeQuietly(new TargusError('unauthorized', 'TARGUS_TOKEN is not set'))).toEqual({
      message: 'error: TARGUS_TOKEN is not set',
      exitCode: 3,
      code: 'targus.unauthorized',
    });
  });

  it('names the API URL and the reason when the API cannot be reached', async () => {
    const api = new TargusApiClient({
      baseUrl: 'http://localhost:8787',
      token: 't',
      fetch: () => Promise.reject(new TypeError('fetch failed', { cause: refused })),
      sleep: () => Promise.resolve(),
    });
    const error: unknown = await api.getImage('abc').catch((caught: unknown) => caught);

    expect(describeQuietly(error)).toEqual({
      message:
        'error: GET /api/images/abc: cannot reach http://localhost:8787 (gave up after 4 attempts)\n' +
        '  connection refused: 127.0.0.1:8787\n' +
        '  check the API URL (TARGUS_API_URL or --api-url) and that the targus API is reachable',
      exitCode: 1,
      code: 'targus.internal',
    });
  });
});

describe('describeError for network failures', () => {
  it('names the host that could not be resolved', () => {
    const notFound = systemError('getaddrinfo ENOTFOUND api.targus.invalid', {
      code: 'ENOTFOUND',
      hostname: 'api.targus.invalid',
    });
    const report = describeQuietly(new TypeError('fetch failed', { cause: notFound }));

    expect(report.message).toMatch(/^error: host not found: api\.targus\.invalid\n {2}check/);
    expect(report.code).toBe('targus.network');
    expect(report.exitCode).toBe(1);
  });

  it('falls back to the error code when there is no address', () => {
    const report = describeQuietly(systemError('', { code: 'ECONNREFUSED' }));

    expect(report.message).toMatch(/^error: connection refused \(ECONNREFUSED\)\n/);
  });
});

describe('describeError for files and commands', () => {
  it('names a file that is not readable', () => {
    const report = describeQuietly(systemError('EACCES', { code: 'EACCES', path: '/out' }));

    expect(report).toEqual({
      message: 'error: permission denied: /out',
      exitCode: 1,
      code: 'targus.file_access',
    });
  });

  it('names a command that is not installed, through the ExecError that wraps it', () => {
    const spawn = systemError('spawn xcrun ENOENT', {
      code: 'ENOENT',
      syscall: 'spawn xcrun',
      path: 'xcrun',
    });
    const error = new ExecError('xcrun simctl boot SIM failed: spawn xcrun ENOENT', '', {
      cause: spawn,
    });

    expect(describeQuietly(error)).toEqual({
      message:
        'error: command not found: xcrun\n' +
        '  install Xcode and its command line tools (xcode-select --install)',
      exitCode: 1,
      code: 'targus.command_not_found',
    });
  });

  it('suggests installing any other missing command', () => {
    const spawn = systemError('spawn magick ENOENT', { code: 'ENOENT', syscall: 'spawn magick' });

    expect(describeQuietly(spawn).message).toBe(
      'error: command not found: magick\n  install magick or add it to PATH',
    );
  });

  it('prints a command that ran and failed as it is', () => {
    const exited = Object.assign(new Error('exit 1'), { code: 1 });
    const error = new ExecError('git fetch failed: no remote', 'no remote', { cause: exited });

    expect(describeQuietly(error)).toEqual({
      message: 'error: git fetch failed: no remote',
      exitCode: 1,
      code: 'targus.exec',
    });
  });

  it('says which port is taken', () => {
    const report = describeQuietly(systemError('listen', { code: 'EADDRINUSE', port: 7007 }));

    expect(report.message).toMatch(/^error: port 7007 is already in use\n.*--port$/);
    expect(report.code).toBe('targus.port_in_use');
  });
});

describe('describeError for validation failures', () => {
  it('summarises the zod issues instead of dumping the ZodError', () => {
    const parsed = z.object({ udid: z.string(), state: z.string() }).safeParse({ udid: 1 });
    if (parsed.success) throw new Error('expected a parse failure');

    expect(describeQuietly(parsed.error)).toEqual({
      message:
        'error: data did not have the expected shape (2 issues):\n' +
        '  - udid: Invalid input: expected string, received number\n' +
        '  - state: Invalid input: expected string, received undefined',
      exitCode: 1,
      code: 'targus.invalid_data',
    });
  });

  it('lists at most five issues', () => {
    const parsed = z.array(z.string()).safeParse([1, 2, 3, 4, 5, 6, 7]);
    if (parsed.success) throw new Error('expected a parse failure');
    const { message } = describeQuietly(parsed.error);

    expect(message).toContain('(7 issues)');
    expect(message).toContain('- 4: Invalid input');
    expect(message).not.toContain('- 5: Invalid input');
    expect(message).toMatch(/- and 2 more$/);
  });
});

describe('describeError for anything else', () => {
  it('calls it unexpected and points at TARGUS_DEBUG', () => {
    expect(describeQuietly('a string')).toEqual({
      message:
        'error: unexpected error: a string\n' +
        '  this is probably a bug in targus; run again with TARGUS_DEBUG=1 for the stack trace',
      exitCode: 1,
      code: 'targus.unexpected',
    });
  });

  it('appends the stack of the error and each cause in debug mode', () => {
    const error = new TargusError('internal', 'outer', { cause: new Error('inner') });
    const { message } = describeError(error, { debug: true });

    expect(message).toMatch(/^error: outer\n\nTargusError: outer\n\s+at /);
    expect(message).toMatch(/\ncaused by: Error: inner\n\s+at /);
  });
});
