// @ts-check
// Shared helpers for the `yarn new:*` generators (docs/engineering-standards.md section 4.4).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { format, resolveConfig } from 'prettier';

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
 * Word-wrap prose into comment lines that start with `prefix` and fit Prettier's 100 columns,
 * which Prettier itself does not do for comments. A blank line in `text` starts a paragraph.
 * @param {string} text
 * @param {string} prefix
 */
export function wrap(text, prefix) {
  return text
    .split('\n\n')
    .map((paragraph) => wrapParagraph(paragraph, prefix))
    .join(`\n${prefix.trimEnd()}\n`);
}

/**
 * @param {string} text
 * @param {string} prefix
 */
function wrapParagraph(text, prefix) {
  /** @type {string[]} */
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line !== '' && prefix.length + line.length + 1 + word.length > 100) {
      lines.push(prefix + line);
      line = word;
    } else line = line === '' ? word : `${line} ${word}`;
  }
  if (line !== '') lines.push(prefix + line);
  return lines.join('\n');
}

/**
 * Format generated files with the repository's Prettier config, so the output passes
 * `prettier --check` whatever the names make the lines' lengths.
 * @param {ReadonlyArray<{ path: string; content: string }>} files paths relative to the repo
 * @returns {Promise<Array<{ path: string; content: string }>>}
 */
export function formatted(files) {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..');
  return Promise.all(
    files.map(async (file) => {
      const filepath = path.join(repoRoot, file.path);
      const options = (await resolveConfig(filepath)) ?? {};
      return { path: file.path, content: await format(file.content, { ...options, filepath }) };
    }),
  );
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
 * @param {(args: string[], root: string) => Promise<string>} main
 */
export async function runCli(main) {
  try {
    console.log(await main(process.argv.slice(2), process.cwd()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
