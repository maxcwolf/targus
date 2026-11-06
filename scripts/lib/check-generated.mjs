// @ts-check
// Test helper for the generators: run them into the real tree under a probe name, check what
// they wrote the way `yarn check` would (TypeScript, ESLint, Prettier), and delete it again
// whatever happens. A copy of the tree would not do: typed linting and the `development`
// condition need the repository's own tsconfig projects and node_modules.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { withBuildLock } from './build-packages.mjs';
import { appFile, unregisterRoute } from './register-route.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const bins = {
  tsc: require.resolve('typescript/bin/tsc'),
  eslint: path.join(path.dirname(require.resolve('eslint/package.json')), 'bin/eslint.js'),
  prettier: require.resolve('prettier/bin/prettier.cjs'),
};

/**
 * @param {string} script
 * @param {string[]} args
 * @returns {Promise<{ ok: boolean; output: string }>}
 */
function node(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: repoRoot });
    let output = '';
    child.stdout.on('data', (chunk) => (output += String(chunk)));
    child.stderr.on('data', (chunk) => (output += String(chunk)));
    child.on('close', (status) => {
      resolve({ ok: status === 0, output });
    });
  });
}

/**
 * Type-check one project with its own compiler options, from source and without emitting.
 * `tsc -b` would also rebuild referenced projects and write .tsbuild/ output, so this extends
 * the project's tsconfig with emit turned off and its references dropped; workspace packages
 * then resolve to their source through the "development" condition, as in tests (ADR 0010).
 * @param {string} tsconfig repo-relative, for example apps/api/tsconfig.worker.json
 */
async function typecheck(tsconfig) {
  const name = path.basename(tsconfig, '.json');
  const dir = path.join(repoRoot, path.dirname(tsconfig), '.tsbuild', `generator-check-${name}`);
  const probe = path.join(dir, 'tsconfig.json');
  mkdirSync(dir, { recursive: true });
  const compilerOptions = {
    composite: false,
    incremental: false,
    tsBuildInfoFile: null,
    declaration: false,
    declarationMap: false,
    emitDeclarationOnly: false,
    noEmit: true,
    rootDir: repoRoot,
  };
  writeFileSync(probe, JSON.stringify({ extends: path.join(repoRoot, tsconfig), compilerOptions }));
  try {
    const result = await node(bins.tsc, ['-p', probe]);
    return { ...result, output: `${tsconfig}:\n${result.output}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Undo what an interrupted run may have left: every file whose name starts with `probe` in
 * `dirs` (repo-relative), and a mount of route `probe` in app.ts. The probe files are also
 * gitignored, so a leftover is never committed by accident.
 * @param {string} probe
 * @param {string[]} dirs
 */
export function removeProbeLeftovers(probe, dirs) {
  for (const dir of dirs) {
    const absolute = path.join(repoRoot, dir);
    if (!existsSync(absolute)) continue;
    for (const entry of readdirSync(absolute)) {
      if (entry.startsWith(probe)) rmSync(path.join(absolute, entry), { force: true });
    }
  }
  const app = path.join(repoRoot, appFile);
  const source = readFileSync(app, 'utf8');
  const cleaned = unregisterRoute(source, probe);
  if (cleaned !== source) writeFileSync(app, cleaned);
}

/** @param {string} output */
function createdFiles(output) {
  return [...output.matchAll(/^created (.+)$/gm)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/**
 * @typedef {object} CheckRequest
 * @property {ReadonlyArray<{ script: string; args: string[] }>} runs each generator call
 * @property {string[]} tsconfigs projects that, between them, include every generated file
 * @property {ReadonlyArray<{ path: string; content: string }>} [extra] more probe files to
 *   write and check with the generated ones (repo-relative)
 */

/**
 * @param {CheckRequest} request
 * @param {string[]} files filled in as files are created, so the caller can delete them
 * @returns {Promise<string[]>} failures
 */
async function generateThenCheck({ runs, tsconfigs, extra = [] }, files) {
  for (const { script, args } of runs) {
    const generated = await node(path.join(import.meta.dirname, '..', script), args);
    files.push(...createdFiles(generated.output));
    if (!generated.ok) return [`${script} ${args.join(' ')}:\n${generated.output}`];
  }
  for (const file of extra) {
    writeFileSync(path.join(repoRoot, file.path), file.content);
    files.push(file.path);
  }
  const checks = await Promise.all([
    ...tsconfigs.map(typecheck),
    node(bins.eslint, ['--max-warnings', '0', ...files]),
    // The probe files are gitignored, which Prettier would honour and skip them.
    node(bins.prettier, ['--check', '--ignore-path', '.prettierignore', ...files]),
  ]);
  return checks.filter((result) => !result.ok).map((result) => result.output);
}

/**
 * Run each generator call in `runs` in the repository, then type-check `tsconfigs` and lint and
 * format-check what was written. Only files the generators report as created (and `extra`)
 * are deleted, even when a check fails. Holds the build lock throughout, so no `tsc -b`
 * of a package emits a probe file.
 * @param {CheckRequest} request
 * @returns {Promise<{ files: string[]; failures: string[] }>}
 */
export function generateAndCheck(request) {
  return withBuildLock(async () => {
    /** @type {string[]} */
    const files = [];
    try {
      const failures = await generateThenCheck(request, files);
      return { files: [...files], failures };
    } finally {
      for (const file of files) rmSync(path.join(repoRoot, file), { force: true });
    }
  });
}
