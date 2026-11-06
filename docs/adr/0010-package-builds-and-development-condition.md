# 0010. Package builds and the development condition

## Status

accepted, amended by [0025](0025-browser-entry-for-core.md)

## Amended by

The builds and the `development` condition still hold. One part of the text below was overtaken:

- **One entry per package.** `@targus/core` also exports `./browser` (`src/browser.ts`, built
  to `dist/browser.js`, same condition shape), everything in core but the pngjs image code. The
  web app imports that entry, because its dev server runs core's source unbundled (ADR 0025).

## Date

2026-11-04

## Context

`@targus/core`, `@targus/cli` and `@targus/react-native` exported `./src/index.ts`. That works for
anything that compiles TypeScript on the fly (Vitest, Vite, wrangler), but not for Node or an npm
consumer: the CLI's own `dist/bin.js` could not import `@targus/core` at runtime, so the CLI was
left without the dependency. The packages are meant to be published, so each needs a built
entry, while tests and local dev should keep running against source without a build step.

Tool behaviour observed with the pinned versions (Vite 8.3, Vitest 5.1, wrangler 4.157):

- Vite and Vitest already enable `development` outside production through their
  `development|production` default condition. Node-environment Vitest tests resolve in Vite's
  `ssr` environment, so the setting that applies there is `ssr.resolve.conditions`; the
  top-level `resolve.conditions` only reaches the client (jsdom) environment.
- `vite build` picks `production`. Forcing `development` into a production build would also
  ship the development builds of `@tanstack/react-router` and `seroval`, which export one.
- wrangler bundles with esbuild using `workerd, worker, browser` only. `wrangler.jsonc` has no
  field for conditions; the `WRANGLER_BUILD_CONDITIONS` environment variable replaces the list.
- `tsc -b` decides "up to date" from the `.tsbuildinfo` file, not from the outputs, so deleting
  `dist/` alone does not trigger a rebuild (`tsc -b --clean` or `--force` does).

## Decision

We will build each package with `tsc -b` to `dist/` (ESM `.js`, `.d.ts`, declaration and source
maps). Each package's `tsconfig.json` is a solution of `tsconfig.lib.json` (src without tests,
emits `dist/`, Node `nodenext` rules) and `tsconfig.test.json` (tests and config, types only).
The root `tsc -b` (`yarn typecheck`, first step of `yarn check`) builds them.

Each package exports
`{ "development": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" }`
with `main`/`types` fallbacks and `files: ["dist"]`. `publishConfig.exports` drops the
`development` entry from the published manifest, because `src/` is not published and bundlers
in consumer apps (Vite, webpack) set `development` in dev.

The repo opts into `development` everywhere it runs source: `customConditions` in
`tsconfig.base.json`, Vitest configs (`ssr.resolve` for Node tests, `resolve` for jsdom and the
Workers pool), `vite` dev for the web app, `yarn workspace @targus/api dev` (via
`WRANGLER_BUILD_CONDITIONS`) and dependency-cruiser. Production bundles (`vite build`,
`wrangler deploy`) consume `dist/`; their scripts build core first. Node and npm consumers never
set the condition and get `dist/`. `scripts/package-builds.test.mjs` runs the built CLI.

## Consequences

### Positive

- `node packages/cli/dist/bin.js` and npm installs resolve `@targus/core` at runtime.
- Tests and dev servers still need no build and always see current source.
- What ships is what `yarn check` builds and runs.

### Negative

- Two tsconfigs per package, and a `tsconfig.lib.json` reference for anything importing one.
- Production app builds depend on `dist/` being current; their scripts run `tsc -b` first.
- Relying on Yarn's `publishConfig.exports`: publishing with plain `npm publish` would ship the
  `development` entry pointing at an unpublished `src/`.

## Alternatives considered

- **Bundle each package (tsup, tsdown).** Another tool and config for packages that `tsc` emits
  as-is.
- **A custom condition name such as `@targus/source`.** Avoids colliding with the conventional
  `development` that Vite and webpack set, but every tool would need it configured explicitly;
  stripping the entry at publish gets the same safety.
- **Always resolve `dist/`.** Every test and dev run would need a build first and could run
  stale code.
