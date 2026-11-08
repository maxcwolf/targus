# 0017. Relative imports name the TypeScript file

## Status

accepted, amended by [0034](0034-published-declarations-name-the-js-file.md)

## Amended by

The decision still holds. One consequence below was overtaken:

- **Published declaration files keep the `.ts` paths.** A post-build step,
  `scripts/fix-declarations.mjs`, now rewrites them to `.js` in `dist/**/*.d.ts`, and a script
  test fails if one is left (ADR 0034).

## Date

2026-11-06

## Context

Every relative import in the repo ended in `.js` (`import { x } from './user.repository.js'`)
although no such file exists in `src/`: the import pointed at `user.repository.ts`. This is what
Node's ES module rules required of TypeScript before 5.7. Node needs the full file name in a
relative import, `tsc` did not rewrite import paths, so the source had to name the file that
would exist after compiling. The three published packages compile with `tsc -b` under
`nodenext` (ADR 0010), which made the extension mandatory there, and the apps followed for one
style.

It reads as a mistake to anyone who has not met the convention, and it makes "go to the file
this import names" a lie. TypeScript 5.7 added `rewriteRelativeImportExtensions`: source imports
may name the `.ts` file and the compiler rewrites the extension in emitted JavaScript. Node's
own TypeScript support, Deno and Bun require the `.ts` name, so this is the direction the
ecosystem took. The repo is on TypeScript 6.0.

## Decision

We will write relative imports with the real file name: `./file.ts` or `./file.tsx`.

- `tsconfig.base.json` sets `allowImportingTsExtensions`, so every project accepts the `.ts`
  name.
- Each package's `tsconfig.lib.json`, the only projects that emit JavaScript, also sets
  `rewriteRelativeImportExtensions`, so `dist/` contains `.js` paths and runs on Node as before.
  The flag stays off elsewhere: a types-only test project that imports from the library project
  would otherwise fail with TS2878.
- ESLint rejects a relative import that ends in `.js` in a TypeScript file
  (`targus/import-extensions` in `eslint.config.js`).
- The generators (`yarn new:route`, `yarn new:adapter`) emit `.ts` imports.

Imports of packages (`@targus/core`, `zod`) are unchanged.

## Consequences

### Positive

- An import names a file that exists, so the path can be followed by eye and by tooling.
- The source runs unchanged under runtimes that execute TypeScript directly.
- Published JavaScript behaves as before: `dist/` still contains `.js` paths.

### Negative

- Published declaration files keep the `.ts` paths, because the compiler does not rewrite them
  in `.d.ts` output. TypeScript 5.0 and later resolves `./x.ts` in a declaration file to
  `./x.d.ts`; TypeScript 4.9 does not, so consumers need 5.0 or later. zod 4 already requires
  5.4 or later, so this adds no new floor.
- `rewriteRelativeImportExtensions` only rewrites relative paths. A future path alias or
  `#imports` entry that ends in `.ts` would not be rewritten and must not be introduced into the
  emitting projects without revisiting this.
- A second emitting project must remember to set the flag; the lint rule does not check that.

## Alternatives considered

- **Keep `.js` imports.** Correct and widely used, but it is the thing newcomers trip over, and
  nothing is gained by keeping it now that the compiler can rewrite.
- **Extensionless imports.** Only work where a bundler resolves them, so the three published
  packages would have to move from `tsc -b` to a bundler, reversing ADR 0010.
