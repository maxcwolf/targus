# 0034. Published declaration files name the `.js` file

## Status

accepted

## Date

2026-11-07

## Context

Since ADR 0017, relative imports in source name the TypeScript file (`./with-targus.ts`), and
each package's `tsconfig.lib.json` sets `rewriteRelativeImportExtensions`, so the emitted
JavaScript in `dist/` says `./with-targus.js`. The compiler does not apply that rewrite to
declaration output. `packages/react-native/dist/index.d.ts` said
`export { … } from './with-targus.ts'`, and no `with-targus.ts` exists in `dist/`.

ADR 0017 accepted this because TypeScript 5.0 and later resolves `./x.ts` in a declaration file
to `./x.d.ts`. Tools that follow declarations by file name do not. When a consumer app installed
`@targus/react-native` through a Yarn `portal:` to a targus checkout, its dependency-cruiser run
failed with `not-to-unresolvable: …/dist/index.d.ts → ./with-targus.ts`. The same would happen to
an npm consumer.

TypeScript 6.0.3, the pinned version, has no option that rewrites specifiers in declaration
output. `tsc -b` cannot load custom transformers, so the rewrite has to run after it.

## Decision

We will rewrite the declaration files after every `tsc -b` that emits a published package.

- `scripts/fix-declarations.mjs` (logic in `scripts/lib/declaration-specifiers.mjs`) rewrites
  relative specifiers ending in `.ts`, `.tsx`, `.mts` or `.cts` in `dist/**/*.d.ts` to the
  extension tsc gives the emitted JavaScript (`.js`, `.js`, `.mjs`, `.cjs`). Where a rewrite
  changes a line's length (`.tsx` to `.js`), it moves the generated columns in that line of the
  `.d.ts.map`, so the map still points at the source. The step is idempotent.
- It runs in the root `yarn typecheck` (`tsc -b && node scripts/fix-declarations.mjs`, the first
  step of `yarn check`), in each published package's `build` script, in the CLI's
  `fixture:capture`, and in `scripts/lib/build-packages.mjs`, which the script tests use to build.
- `scripts/package-builds.test.mjs` fails when any built `.d.ts` in the three packages contains a
  relative `.ts`/`.tsx` path, when a relative import in one does not resolve to an existing
  declaration file, when a declaration map names a missing source, or when a package script that
  runs `tsc -b` does not also run the fix.

Source imports keep naming the `.ts` file (ADR 0017). This amends the first negative consequence
of ADR 0017.

## Consequences

### Positive

- Published declarations reference files that exist, so dependency-cruiser, API extractors and
  other tools that follow `.d.ts` imports resolve them, and consumers no longer need a TypeScript
  that maps `./x.ts` to `./x.d.ts`.
- The rewrite is a test-guarded step, not a convention someone has to remember.

### Negative

- `tsc -b` on its own (an editor build, or a command typed by hand) still leaves `.ts` paths in
  `dist/` until the next `yarn typecheck` or package `build`. The script tests rebuild and fix
  before they check, so CI catches a missed entry point but not a stale local `dist/`.
- The rewrite is a regular expression over declaration text. It only touches quoted relative
  paths in module positions (`from`, `import`, `import()`, `require()`, `declare module`), which
  is what tsc emits, but a new kind of module reference would need adding there.
- A new script that emits a published `dist/` has to run the fix; the test checks the package
  scripts, not commands elsewhere.

## Alternatives considered

- **A tsc option.** None exists in TypeScript 6.0 (`rewriteRelativeImportExtensions` only covers
  JavaScript output).
- **A custom build script on the compiler API with an `afterDeclarations` transformer.** Correct
  maps for free, but it would replace `tsc -b` in `yarn typecheck` and every package build with
  our own build driver, its error reporting and its watch mode, for a one-line rewrite.
- **Go back to `.js` imports in source.** Reverses ADR 0017 for the whole repo to fix the output
  of three packages.
- **Bundle the declarations (rollup-plugin-dts, tsup).** One `.d.ts` per entry has no relative
  imports, but adds a bundler per package, which ADR 0010 declined.
