import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// Migration drift guard (docs/engineering-standards.md section 3.2, api): generating from
// each schema against a copy of its committed migrations must produce nothing new. Runs in
// Node (vitest.node.config.ts) because drizzle-kit cannot run inside workerd.
const apiDir = path.resolve(import.meta.dirname, '../..');
let scratch: string | undefined;

afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

/** Each dialect's schema, and the committed migrations drizzle-kit generated from it. */
const dialects = [
  { dialect: 'sqlite', schema: './src/db/schema.ts', migrations: 'migrations' },
  { dialect: 'postgresql', schema: './src/postgres/schema.ts', migrations: 'migrations-postgres' },
] as const;

describe('committed migrations', () => {
  it.each(dialects)(
    'match $schema (drizzle-kit generate finds no changes)',
    ({ dialect, schema, migrations }) => {
      scratch = mkdtempSync(path.join(tmpdir(), 'targus-drift-'));
      const out = path.join(scratch, 'migrations');
      cpSync(path.join(apiDir, migrations), out, { recursive: true });
      const before = readdirSync(out, { recursive: true }).sort();

      // drizzle-kit prefixes --out with "./", so it must be relative to the working directory.
      const args = [
        `--dialect=${dialect}`,
        `--schema=${schema}`,
        `--out=${path.relative(apiDir, out)}`,
      ];
      const stdout = execFileSync('yarn', ['drizzle-kit', 'generate', ...args], {
        cwd: apiDir,
        encoding: 'utf8',
      });

      expect(stdout).toContain('No schema changes');
      expect(readdirSync(out, { recursive: true }).sort()).toEqual(before);
    },
  );
});
