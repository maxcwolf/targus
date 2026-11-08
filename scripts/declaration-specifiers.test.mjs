// @ts-check
// The post-build rewrite of declaration files (ADR 0034). The guard over the real dist/ output is
// in package-builds.test.mjs.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  fixDeclarations,
  relativeTsSpecifiers,
  rewriteDeclarationSpecifiers,
  shiftMappings,
} from './lib/declaration-specifiers.mjs';

describe('rewriteDeclarationSpecifiers', () => {
  it('names the emitted .js file in every place a declaration file names a module', () => {
    const source = [
      "export type { A } from './a.ts';",
      'export * from "../b.ts";',
      "import './side-effect.ts';",
      "export declare const c: typeof import('./c.ts').c;",
      "declare module './d.ts' {}",
      "export { e } from './e.mts';",
      "export { f } from './f.cts';",
      "export type { G } from './g.d.ts';",
    ].join('\n');

    assert.equal(
      rewriteDeclarationSpecifiers(source).text,
      [
        "export type { A } from './a.js';",
        'export * from "../b.js";',
        "import './side-effect.js';",
        "export declare const c: typeof import('./c.js').c;",
        "declare module './d.js' {}",
        "export { e } from './e.mjs';",
        "export { f } from './f.cjs';",
        "export type { G } from './g.js';",
      ].join('\n'),
    );
  });

  it('leaves package specifiers, .js specifiers and other strings alone', () => {
    const source = [
      "import type { z } from 'zod';",
      "export { h } from './h.js';",
      "export declare const file: './not-an-import.ts';",
    ].join('\n');

    assert.equal(rewriteDeclarationSpecifiers(source).text, source);
  });

  it('is idempotent and reports no shift when every line keeps its length', () => {
    const once = rewriteDeclarationSpecifiers("export { a } from './a.ts';");

    assert.deepEqual(once.shifts, []);
    assert.equal(rewriteDeclarationSpecifiers(once.text).text, once.text);
  });

  it('reports where a .tsx specifier shortened its line', () => {
    const { text, shifts } = rewriteDeclarationSpecifiers(
      "export {};\nexport { a } from './a.tsx'; export { b } from './b.tsx';",
    );

    assert.equal(text, "export {};\nexport { a } from './a.js'; export { b } from './b.js';");
    assert.deepEqual(shifts, [
      { line: 1, column: 26, delta: -1 },
      { line: 1, column: 55, delta: -1 },
    ]);
  });
});

describe('shiftMappings', () => {
  it('moves the generated columns after each edit and nothing before it', () => {
    // Line 0 untouched; line 1 has segments at columns 0, 9, 27 (the `;` after './a.tsx').
    const mappings = 'AAAA;AACA,SAAS,kBAAS';

    assert.equal(
      shiftMappings(mappings, [{ line: 1, column: 26, delta: -1 }]),
      'AAAA;AACA,SAAS,iBAAS',
    );
  });

  it('applies two edits on one line to the first segment past each', () => {
    // Segments at columns 0, 27 and 56; edits end at columns 26 and 55.
    const mappings = 'AAAA,2BAAS,6BAAS';

    assert.equal(
      shiftMappings(mappings, [
        { line: 0, column: 26, delta: -1 },
        { line: 0, column: 55, delta: -1 },
      ]),
      'AAAA,0BAAS,4BAAS',
    );
  });
});

describe('relativeTsSpecifiers', () => {
  it('finds quoted relative paths with a TypeScript extension anywhere', () => {
    const text = "export { a } from './a.ts';\nexport * from 'zod';\nx: \"../b.tsx\"; './c.js'";

    assert.deepEqual(relativeTsSpecifiers(text), ['./a.ts', '../b.tsx']);
  });
});

describe('fixDeclarations', () => {
  it('rewrites .d.ts files under a directory, adjusts their maps and skips other files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'targus-declarations-'));
    try {
      writeFileSync(path.join(dir, 'index.d.ts'), "export { a } from './a.tsx';\n");
      writeFileSync(
        path.join(dir, 'index.d.ts.map'),
        JSON.stringify({ version: 3, sources: ['../src/index.ts'], mappings: 'AAAA,SAAS,kBAAS' }),
      );
      writeFileSync(path.join(dir, 'index.js'), "export { a } from './a.ts';\n");

      assert.equal(fixDeclarations(dir), 1);
      assert.equal(
        readFileSync(path.join(dir, 'index.d.ts'), 'utf8'),
        "export { a } from './a.js';\n",
      );
      /** @type {unknown} */
      const map = JSON.parse(readFileSync(path.join(dir, 'index.d.ts.map'), 'utf8'));
      assert.deepEqual(map, {
        version: 3,
        sources: ['../src/index.ts'],
        mappings: 'AAAA,SAAS,iBAAS',
      });
      assert.equal(
        readFileSync(path.join(dir, 'index.js'), 'utf8'),
        "export { a } from './a.ts';\n",
      );
      assert.equal(fixDeclarations(dir), 0);
      assert.equal(fixDeclarations(path.join(dir, 'missing')), 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
