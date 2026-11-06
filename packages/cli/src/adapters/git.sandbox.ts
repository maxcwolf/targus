import { execFile } from 'node:child_process';

import { inheritedEnv } from '../config.ts';
import { ExecError, type Exec } from './exec.adapter.ts';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Test-only: the environment for a git child process that can reach no repository but the one
 * `-C` names. Git exports `GIT_DIR` and friends to hooks (lefthook's pre-push runs `yarn check`),
 * and with an inherited `GIT_DIR`, `git -C <tmp> init` re-initialises the hook's repository
 * instead of `<tmp>`. So every `GIT_*` variable is dropped (a superset of
 * `git rev-parse --local-env-vars`, plus `GIT_NAMESPACE` and `GIT_CEILING_DIRECTORIES`), and the
 * user's global and system config are ignored so results do not depend on the machine.
 *
 * Production code must not use this: there, honouring the caller's `GIT_DIR` is correct.
 */
export function isolatedGitEnv(parent: Env = inheritedEnv()): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value !== undefined && !name.startsWith('GIT_')) env[name] = value;
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
}

/**
 * Test-only `Exec` that runs every command in `isolatedGitEnv(parent)`. It replaces the
 * environment rather than adding to it, which `execFileBuffer` cannot do, and fails like
 * `execFileBuffer` (an `ExecError` whose cause carries the exit status).
 */
export function isolatedGitExec(parent: Env = inheritedEnv()): Exec {
  return (file, args, options = {}) =>
    new Promise((resolve, reject) => {
      const env = { ...isolatedGitEnv(parent), ...options.env };
      execFile(
        file,
        [...args],
        { encoding: 'buffer', env, timeout: options.timeoutMs ?? 0 },
        (error, stdout, stderr) => {
          const stderrText = stderr.toString('utf8');
          if (error) {
            const message = `${[file, ...args].join(' ')} failed: ${stderrText.trim() || error.message}`;
            reject(new ExecError(message, stderrText, { cause: error }));
            return;
          }
          resolve({ stdout, stderr: stderrText });
        },
      );
    });
}
