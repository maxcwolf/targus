import { spawn, type ChildProcess } from 'node:child_process';
import { openSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import { repoRoot } from './cli.ts';
import { workerEnv } from './local-worker.ts';

// Child processes of `yarn dev:local` (local.ts). Each runs in its own process group, so
// stopping one also stops what it started (yarn -> wrangler -> workerd).

/** Process group ids of every child started, running or not. */
const groups = new Set<number>();

/** Fail fast when something already listens on `port`, so we never talk to a stranger's server. */
export function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => {
      reject(new Error(`port ${port} is in use; stop what listens there or choose another port`));
    });
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => {
        resolve();
      });
    });
  });
}

function start(command: string, stdio: 'inherit' | number): ChildProcess {
  const env = Object.entries(workerEnv).map(([name, value]) => `${name}=${value}`);
  const child = spawn([...env, command].join(' '), {
    cwd: repoRoot,
    shell: true,
    detached: true,
    stdio: ['ignore', stdio, stdio],
  });
  if (child.pid !== undefined) groups.add(child.pid);
  return child;
}

/** Run a shell command from the repo root, its output on ours, and wait for it to succeed. */
export function runStep(command: string): Promise<void> {
  const child = start(command, 'inherit');
  const name = command.split(' ').slice(0, 4).join(' ');
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${name} failed (${String(code ?? signal)})`));
    });
  });
}

/** Start a long-running shell command whose output goes to `logFile`. */
export function startService(command: string, logFile: string): ChildProcess {
  return start(command, openSync(logFile, 'w'));
}

/** Poll `url` until it answers 2xx; throws after `attempts` tries half a second apart. */
export async function waitForOk(url: string, attempts = 240): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const ok = await fetch(url).then(
      (response) => response.ok,
      () => false,
    );
    if (ok) return;
    await sleep(500);
  }
  throw new Error(`${url} did not answer in time`);
}

/** Send `signal` to a process group; false when no process of the group is left. */
function signalGroup(group: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-group, signal);
    return true;
  } catch {
    return false;
  }
}

/** SIGTERM the group, wait up to ten seconds for all of it to exit, then SIGKILL what is left. */
async function stopGroup(group: number): Promise<void> {
  if (!signalGroup(group, 'SIGTERM')) return;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await sleep(100);
    if (!signalGroup(group, 0)) return;
  }
  signalGroup(group, 'SIGKILL');
}

/** Stop every child and everything it started. */
export async function stopAll(): Promise<void> {
  await Promise.all([...groups].map(stopGroup));
  groups.clear();
}
