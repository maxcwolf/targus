// @ts-check
// `tsc -b` of some packages, one at a time per worktree. Script tests that need a built package
// run in parallel (node --test), and so can two `yarn check` runs in one worktree; two `tsc -b`
// writing the same dist/ at once could let a reader see a half-written file. When the packages
// are already up to date (`yarn check` runs `tsc -b` first) the build is a quick no-op.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { fixPackageDeclarations, publishedPackages } from './declaration-specifiers.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
// mkdir is atomic: whoever creates the directory holds the lock. Gitignored (.tsbuild/).
const lockDir = path.join(repoRoot, '.tsbuild', 'build-packages.lock');

/** Wait for the lock; after two minutes assume its holder died and go ahead anyway. */
async function acquire() {
  mkdirSync(path.dirname(lockDir), { recursive: true });
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      mkdirSync(lockDir);
      return;
    } catch {
      await sleep(200);
    }
  }
}

/**
 * Run `task` while holding the lock, so no `tsc -b` of a package runs meanwhile. The generator
 * check holds it while its probe files sit in packages/cli/src/, which a build would emit.
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
export async function withBuildLock(task) {
  await acquire();
  try {
    return await task();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

/**
 * Build `projects` (paths relative to the repo root) with `tsc -b`, then fix the declaration
 * files the way every package build does (scripts/fix-declarations.mjs, ADR 0034).
 * @param {string[]} projects
 * @returns {Promise<{ status: number | null, output: string }>}
 */
export function buildPackages(projects) {
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  return withBuildLock(() => {
    const build = spawnSync(process.execPath, [tsc, '-b', ...projects], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (build.status === 0) {
      fixPackageDeclarations(publishedPackages.map((dir) => path.join(repoRoot, dir)));
    }
    return Promise.resolve({ status: build.status, output: build.stdout + build.stderr });
  });
}
