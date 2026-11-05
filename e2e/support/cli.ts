import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { e2eConfig } from '../config.js';

const execFileAsync = promisify(execFile);

export const repoRoot = path.resolve(import.meta.dirname, '..', '..');
/** The built CLI; the `e2e` script runs `yarn workspace @targus/cli build` first. */
const cliBin = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js');

/** `git rev-parse HEAD` of the repo: the CLI reads git from its cwd, which is the repo. */
export async function headSha(): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
  return stdout.trim();
}

/**
 * A minimal environment for the CLI: no CI variables leak in (the flags decide branch and PR),
 * and git never prompts, so the best-effort `git fetch origin <base>` fails fast offline.
 */
function cliEnv(token: string): NodeJS.ProcessEnv {
  return {
    PATH: e2eConfig.path,
    ...(e2eConfig.home === undefined ? {} : { HOME: e2eConfig.home }),
    TARGUS_TOKEN: token,
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=5',
  };
}

export interface TargusRun {
  readonly buildId: string;
  readonly stdout: string;
}

/** Run `targus run <args>` from the repo root and read the `build: <id>` line it prints. */
export async function targusRun(token: string, args: readonly string[]): Promise<TargusRun> {
  const { stdout } = await execFileAsync(process.execPath, [cliBin, 'run', ...args], {
    cwd: repoRoot,
    env: cliEnv(token),
  });
  const buildId = /^build: (\S+)$/m.exec(stdout)?.[1];
  if (buildId === undefined) throw new Error(`targus run printed no build id:\n${stdout}`);
  return { buildId, stdout };
}
