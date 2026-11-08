// @ts-check
// Runs after every `tsc -b` that emits a published package: rewrites `./x.ts` to `./x.js` in its
// dist/ declaration files, which tsc leaves alone (ADR 0034).
//   node scripts/fix-declarations.mjs              all published packages
//   node scripts/fix-declarations.mjs <dir>...     those package directories
import path from 'node:path';

import { fixPackageDeclarations, publishedPackages } from './lib/declaration-specifiers.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);

fixPackageDeclarations(
  args.length > 0 ? args : publishedPackages.map((dir) => path.join(repoRoot, dir)),
);
