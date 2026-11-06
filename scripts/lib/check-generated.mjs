// @ts-check
// Test helper for the generators: run one into the real tree, check what it wrote the way
// `yarn check` would (TypeScript, ESLint, Prettier), and delete it again whatever happens.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

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
 */
function node(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

/**
 * Type-check one project with its own compiler options, from source and without emitting.
 * `tsc -b` would also rebuild referenced projects and write .tsbuild/ output, so this extends
 * the project's tsconfig with emit turned off and its references dropped; workspace packages
 * then resolve to their source through the "development" condition, as in tests (ADR 0010).
 * @param {string} tsconfig repo-relative, for example apps/api/tsconfig.worker.json
 */
function typecheck(tsconfig) {
  const dir = path.join(repoRoot, path.dirname(tsconfig), '.tsbuild', 'generator-check');
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
    return node(bins.tsc, ['-p', probe]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** @param {string} output */
function createdFiles(output) {
  return [...output.matchAll(/^created (.+)$/gm)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/**
 * Run `scripts/<script>` once per entry of `runs` (its arguments) in the repository, then
 * type-check `tsconfig` (which must include the generated files) and lint and format-check
 * them. Only files the generator reports as created are deleted, even when a check fails.
 * @param {{ script: string; runs: string[][]; tsconfig: string }} options
 * @returns {{ files: string[]; failures: string[] }}
 */
export function generateAndCheck({ script, runs, tsconfig }) {
  /** @type {string[]} */
  const files = [];
  try {
    for (const args of runs) {
      const generated = node(path.join(import.meta.dirname, '..', script), args);
      files.push(...createdFiles(generated.output));
      if (!generated.ok)
        return { files, failures: [`${script} ${args.join(' ')}:\n${generated.output}`] };
    }
    const checks = {
      tsc: typecheck(tsconfig),
      eslint: node(bins.eslint, ['--max-warnings', '0', ...files]),
      prettier: node(bins.prettier, ['--check', ...files]),
    };
    const failures = Object.entries(checks)
      .filter(([, result]) => !result.ok)
      .map(([label, result]) => `${label}:\n${result.output}`);
    return { files, failures };
  } finally {
    for (const file of files) rmSync(path.join(repoRoot, file), { force: true });
  }
}
