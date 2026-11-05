import { execFile } from 'node:child_process';

import { inheritedEnv } from '../config.js';

export interface ExecOptions {
  /** Variables added to the inherited environment for this one call. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface ExecResult {
  readonly stdout: Buffer;
  readonly stderr: string;
}

/** Run a program without a shell. Rejects with an `ExecError` on a non-zero exit. */
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

// Full-resolution simulator screenshots are a few MB; leave generous headroom.
const maxBuffer = 256 * 1024 * 1024;

/** The real `Exec`, built on `child_process.execFile` with binary stdout. */
export const execFileBuffer: Exec = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    const env = { ...inheritedEnv(), ...options.env };
    execFile(file, [...args], { encoding: 'buffer', maxBuffer, env }, (error, stdout, stderr) => {
      const stderrText = stderr.toString('utf8');
      if (error) {
        const command = [file, ...args].join(' ');
        reject(
          new ExecError(`${command} failed: ${stderrText.trim() || error.message}`, stderrText, {
            cause: error,
          }),
        );
        return;
      }
      resolve({ stdout, stderr: stderrText });
    });
  });
