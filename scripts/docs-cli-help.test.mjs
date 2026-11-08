// @ts-check
// The CLI reference's --help blocks are generated (yarn docs:cli); this keeps them current.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';

import { builtCliHelp, helpBlocks, referenceFile, renderCliHelp } from './docs-cli-help.mjs';
import { buildPackages } from './lib/build-packages.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

describe('renderCliHelp', () => {
  it('replaces each block with the help of its command, keeping the text around it', () => {
    const markdown = [
      'intro',
      '<!-- cli-help: -->',
      'stale',
      '<!-- /cli-help -->',
      'between',
      '<!-- cli-help: run -->',
      '```text',
      'old run help',
      '```',
      '<!-- /cli-help -->',
      'outro',
    ].join('\n');

    const rendered = renderCliHelp(markdown, (command) => `help for "${command}"\n\n`);

    assert.equal(
      rendered,
      [
        'intro',
        '<!-- cli-help: -->',
        '```text',
        'help for ""',
        '```',
        '<!-- /cli-help -->',
        'between',
        '<!-- cli-help: run -->',
        '```text',
        'help for "run"',
        '```',
        '<!-- /cli-help -->',
        'outro',
      ].join('\n'),
    );
  });

  it('lists the commands that have blocks', () => {
    const markdown =
      '<!-- cli-help: -->\n<!-- /cli-help -->\n<!-- cli-help: capture -->\n<!-- /cli-help -->';

    assert.deepEqual(helpBlocks(markdown), ['', 'capture']);
  });
});

describe(referenceFile, () => {
  before(async () => {
    const build = await buildPackages(['packages/cli']);
    assert.equal(build.status, 0, build.output);
  });

  it('has a block for targus and for each command', () => {
    const markdown = readFileSync(path.join(repoRoot, referenceFile), 'utf8');

    assert.deepEqual(helpBlocks(markdown), ['', 'capture', 'compare', 'run']);
  });

  it("matches the built CLI's --help (run yarn docs:cli to update it)", () => {
    const markdown = readFileSync(path.join(repoRoot, referenceFile), 'utf8');

    assert.equal(renderCliHelp(markdown, builtCliHelp(repoRoot)), markdown);
  });
});
