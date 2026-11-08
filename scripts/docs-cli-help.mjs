// @ts-check
// yarn docs:cli [--check]
// Rewrites the `targus ... --help` blocks in docs/reference/cli.md from the built CLI
// (packages/cli/dist/bin.js), so the reference can never drift from the flags. With --check it
// changes nothing and fails when the file is stale; scripts/docs-cli-help.test.mjs runs that
// check in `yarn check`. Build the CLI first: `yarn workspace @targus/cli build`.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runCli } from './lib/scaffold.mjs';

export const referenceFile = 'docs/reference/cli.md';

/**
 * A generated block: `<!-- cli-help: run -->`, a fenced text block, `<!-- /cli-help -->`.
 * The name is the subcommand, or empty for `targus --help` itself.
 */
const block = /<!-- cli-help:([ a-z-]*) -->\n[\s\S]*?<!-- \/cli-help -->/g;

/**
 * Replace every generated block in `markdown` with the help text `helpFor` returns for it.
 * @param {string} markdown
 * @param {(command: string) => string} helpFor
 * @returns {string}
 */
export function renderCliHelp(markdown, helpFor) {
  return markdown.replace(block, (_match, /** @type {string} */ name) => {
    const command = name.trim();
    const help = helpFor(command).trimEnd();
    return `<!-- cli-help:${name} -->\n\`\`\`text\n${help}\n\`\`\`\n<!-- /cli-help -->`;
  });
}

/**
 * The commands `markdown` has generated blocks for, in order.
 * @param {string} markdown
 * @returns {string[]}
 */
export function helpBlocks(markdown) {
  return [...markdown.matchAll(block)].map((match) => (match[1] ?? '').trim());
}

/**
 * `targus <command> --help` from the built CLI. Piped stdout has no width, so commander wraps
 * at 80 columns on every machine.
 * @param {string} root
 * @returns {(command: string) => string}
 */
export function builtCliHelp(root) {
  const bin = path.join(root, 'packages/cli/dist/bin.js');
  return (command) => {
    const args = command === '' ? [bin, '--help'] : [bin, command, '--help'];
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(
        `targus ${command} --help exited ${String(result.status)}: ${result.stderr}\n` +
          'build the CLI first: yarn workspace @targus/cli build',
      );
    }
    return result.stdout;
  };
}

/**
 * @param {string[]} args
 * @param {string} root
 * @returns {Promise<string>}
 */
export function main(args, root) {
  const file = path.join(root, referenceFile);
  const current = readFileSync(file, 'utf8');
  const next = renderCliHelp(current, builtCliHelp(root));
  if (args.includes('--check')) {
    if (next !== current) {
      throw new Error(`${referenceFile} is out of date with the CLI's --help: run yarn docs:cli`);
    }
    return Promise.resolve(`${referenceFile} matches the CLI's --help`);
  }
  if (next !== current) writeFileSync(file, next);
  return Promise.resolve(`${referenceFile}: ${String(helpBlocks(next).length)} help blocks`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) void runCli(main);
