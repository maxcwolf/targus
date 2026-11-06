import { execFile } from 'node:child_process';

import { TargusError } from '@targus/core';

import { inheritedEnv } from '../config.js';
import { formatDuration } from '../duration.js';

export interface ExecOptions {
  /** Variables added to the inherited environment for this one call. */
  readonly env?: Readonly<Record<string, string>>;
  /** Kill the program if it runs longer than this; defaults to `defaultExecTimeoutMs`. */
  readonly timeoutMs?: number;
}

export interface ExecResult {
  readonly stdout: Buffer;
  readonly stderr: string;
}

/**
 * Run a program without a shell. Rejects with an `ExecError` on a non-zero exit, and with a
 * `TargusError` naming the command when it outlives its timeout (the program is killed).
 */
export type Exec = (
  file: string,
  args: readonly string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

/** A failed `Exec` call; `stderr` is what the tolerated-error checks match on. */
export class ExecError extends Error {
  override readonly name = 'ExecError';

  constructor(
    message: string,
    readonly stderr: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** The timeout of a call that does not pass one: generous for any quick command. */
export const defaultExecTimeoutMs = 60_000;

// Full-resolution simulator screenshots are a few MB; leave generous headroom.
const maxBuffer = 256 * 1024 * 1024;

export interface ExecFileBufferOptions {
  /** How long a timed-out program gets to exit after SIGTERM before it is sent SIGKILL. */
  readonly killGraceMs?: number;
}

function timedOut(command: string, timeoutMs: number): TargusError {
  return new TargusError(
    'internal',
    `${command} did not finish within ${formatDuration(timeoutMs)} and was stopped`,
  );
}

/** The real `Exec`, built on `child_process.execFile` with binary stdout. */
export function createExecFileBuffer({ killGraceMs = 5_000 }: ExecFileBufferOptions = {}): Exec {
  return (file, args, options = {}) =>
    new Promise((resolve, reject) => {
      const env = { ...inheritedEnv(), ...options.env };
      const command = [file, ...args].join(' ');
      const timeoutMs = options.timeoutMs ?? defaultExecTimeoutMs;
      let expired = false;
      const child = execFile(
        file,
        [...args],
        { encoding: 'buffer', maxBuffer, env },
        (error, stdout, stderr) => {
          clearTimeout(timer);
          if (expired) return;
          const stderrText = stderr.toString('utf8');
          if (!error) {
            resolve({ stdout, stderr: stderrText });
            return;
          }
          const detail = stderrText.trim() || error.message;
          reject(new ExecError(`${command} failed: ${detail}`, stderrText, { cause: error }));
        },
      );
      // Reject at once rather than when the child closes: a grandchild holding the pipes open
      // would otherwise keep the call hanging after the kill.
      const timer = setTimeout(() => {
        expired = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), killGraceMs).unref();
        reject(timedOut(command, timeoutMs));
      }, timeoutMs);
    });
}

export const execFileBuffer: Exec = createExecFileBuffer();
