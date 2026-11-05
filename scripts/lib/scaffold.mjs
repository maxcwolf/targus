// @ts-check
// Shared helpers for the `yarn new:*` generators (docs/engineering-standards.md section 4.4).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const kebabCase = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * @param {string | undefined} value
 * @param {string} label
 * @returns {string}
 */
export function requireKebab(value, label) {
  if (value === undefined || !kebabCase.test(value)) {
    throw new Error(
      `${label} must be kebab-case, for example "build-repository" (got "${value ?? ''}")`,
    );
  }
  return value;
}

/** @param {string} kebab */
export function toPascal(kebab) {
  return kebab
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** @param {string} kebab */
export function toCamel(kebab) {
  const pascal = toPascal(kebab);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Write new files under `root`, refusing to overwrite anything that already exists.
 * @param {string} root
 * @param {ReadonlyArray<{ path: string; content: string }>} files
 * @returns {string[]} the relative paths written
 */
export function writeNewFiles(root, files) {
  const existing = files.filter((file) => existsSync(path.join(root, file.path)));
  if (existing.length > 0) {
    throw new Error(`refusing to overwrite ${existing.map((file) => file.path).join(', ')}`);
  }
  for (const file of files) {
    const target = path.join(root, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  return files.map((file) => file.path);
}

/**
 * Run a generator's `main`, printing its result or its error, and set the exit code.
 * @param {(args: string[], root: string) => string} main
 */
export function runCli(main) {
  try {
    console.log(main(process.argv.slice(2), process.cwd()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
