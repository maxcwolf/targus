# 0025. A browser entry for core, so the web dev server loads no Node-only code

## Status

accepted

## Date

2026-11-06

## Context

`yarn workspace @targus/web dev` rendered a blank page. The browser console showed Vite's
warning `Module "util" has been externalized for browser compatibility`, then
`TypeError: util.inherits is not a function` thrown from `node_modules/.vite/deps/pngjs.js`.
The chain: the web app imports `@targus/core`; the dev server resolves it through the
`development` condition (ADR 0010) to `packages/core/src/index.ts`; that entry re-exports
`diffImages` and `isBlankPng` from `src/images/`, which import pngjs and pixelmatch; pngjs needs
Node's `util`, `zlib` and `stream`, which Vite replaces with empty stubs in client code.

`vite build` was not affected. Rollup tree-shakes `@targus/core`'s `dist/` (`sideEffects: false`)
and drops the image code, so the production bundle never contained pngjs, and the e2e suite,
which runs that bundle, stayed green. The dev server serves every module unbundled and evaluates
whatever an entry imports, so nothing drops it there. No check loaded the app through the dev
server, so the breakage went unnoticed.

The web app needs only the zod contracts, the types and a few pure rules (`needsReview`). The
image code is used only by the CLI.

## Decision

We will give `@targus/core` a second entry, `@targus/core/browser`
(`packages/core/src/browser.ts`, built to `dist/browser.js`), holding everything in core except
the PNG image code. The root entry re-exports it and adds `diffImages` and `isBlankPng`, so every
existing import of `@targus/core` (CLI, API, tests) keeps working unchanged. `exports` and
`publishConfig.exports` list `./browser` with the same `development` / `types` / `default` shape
as `.`.

The web app imports `@targus/core/browser` only. dependency-cruiser enforces it:

- `web-uses-core-browser-entry`: nothing under `apps/web/` imports `packages/core/src/index.ts`.
- `web-never-reaches-node-only-code`: no module under `apps/web/src/` reaches pngjs or pixelmatch,
  directly or transitively.
- `web-no-node-builtins`: nothing under `apps/web/src/` imports a Node builtin.
- `only-public-package-entry` accepts `packages/core/src/browser.ts` as a public entry.

`scripts/web-dev-server.test.mjs` (in `yarn test:scripts`) starts the web app's own Vite with its
own config in middleware mode, walks the client module graph from `/src/main.tsx` as a browser
would, and fails if any module is pngjs, pixelmatch, a `node:` import or one of Vite's
browser-external stubs. It catches what the static rules cannot see, such as a dev-only resolve
setting, and takes well under a second.

## Consequences

### Positive

- The dev server renders the app again, with no change to the production bundle (same bytes).
- The CLI and API import `@targus/core` as before.
- The rule "browser code never loads Node-only code" now has a guard, static and dynamic.

### Negative

- Two entries in core to keep in step: an export added to `browser.ts` reaches both; one added
  only to `index.ts` is invisible to the web app, which is the point but can surprise.
- A published subpath is public API: `@targus/core/browser` must keep working for consumers.

## Alternatives considered

- **Move the image code to its own subpath (`@targus/core/images`) and drop it from the root.**
  Cleaner, but changes the CLI's imports and the root's public surface for no gain to the web app.
- **A `browser` export condition on `.` pointing at a browser build.** Condition order inside
  `exports` and Vite's own `development` and `browser` conditions interact, a second build is
  needed, and the API's Worker bundle (wrangler sets `browser`) would silently switch entries.
- **Stop the web dev server from using the `development` condition.** It would then serve core's
  `dist/`, whose `index.js` still imports the image code, unbundled, so pngjs would load the same
  way; and dev would also need a core build before every start.
- **A `util` polyfill or a Vite alias.** Ships Node shims to the browser to load code the browser
  never runs, and hides the next such import.
