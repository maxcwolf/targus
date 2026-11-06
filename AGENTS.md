# AGENTS.md

Instructions for anyone, human or agent, changing this repo. `CLAUDE.md` imports this file
with `@AGENTS.md`. The rules are enforced by `yarn check` and CI; this page says where things go.
Background: [docs/plan.md](docs/plan.md), [docs/engineering-standards.md](docs/engineering-standards.md).

## Layer map

```
packages/core          pure domain: types, zod contracts, ports, build rules   (no I/O)
packages/cli           adapters + orchestration: simctl, channel server, API client
packages/react-native  app-side helper: withTargus decorator, parameters.targus types
apps/api               createApp(deps): routes -> services -> repositories/ + storage/;
                       Cloudflare only in src/cloudflare/ (Worker entry) and the D1/R2 adapters
apps/web               React review UI: features/ -> api-client/ (components/ are presentational)
e2e/                   Playwright suites against a local Worker (`yarn e2e`)
```

Dependencies point inward: apps and cli depend on core; core depends only on zod, pixelmatch
and pngjs.
Nothing imports an app. A package is reached only through its `src/index.ts`, except that the web
app imports `@targus/core/browser` (`src/browser.ts`), which leaves out the Node-only image code
(ADR 0025).

## Where new code goes

- A business rule with no I/O: `packages/core/src/`, as a plain function with a test beside it.
- A request or response shape: a zod schema in `packages/core/src/contracts/`.
- An HTTP endpoint: `yarn new:route <name>` (creates `apps/api/src/routes/<name>.ts` + test and
  mounts it in `apps/api/src/app.ts`).
  Routes parse, call one service, and map the result. They never import a repository.
- A use-case: `apps/api/src/services/`. The only place rules live outside core.
- D1 or R2 access: `apps/api/src/repositories/` or `apps/api/src/storage/`.
- An implementation of a port: `yarn new:adapter <port> <name>` puts it in the right layer.
- Anything the web app fetches: `apps/web/src/api-client/`, validated with the core schema.
  UI belongs to `apps/web/src/features/<name>/`. No `fetch` anywhere else. Another feature or
  `app/` imports a feature only through its `index.ts`, and the feature graph has no cycle
  (ADR 0019).
- Config: read env or bindings only in a file named `config.ts`, validated with zod.
- Packages build to `dist/` with `tsc -b`; tests and dev servers resolve their `src/` through the
  `development` export condition (ADR 0010). Import another package only through its exports.

## Ports (`packages/core/src/ports/`)

`DeviceDriver`, `StorybookChannel`, `ImageStore`, `BuildRepository`, `GitHubClient`, `Clock`,
`IdGenerator`. Fakes live beside the port (`clock.fake.ts`, `id-generator.fake.ts`) and are
preferred to any other double; the API's in-memory repositories and GitHub stubs are in
`apps/api/test/support/`. Do not `vi.mock` modules except at adapter boundaries. Time and randomness
come from `Clock` and `IdGenerator`; `new Date()`, `Date.now()`, `Math.random()` and
`crypto.randomUUID()` are lint errors outside `**/adapters/**` and `*.adapter.ts`.

## Rules

- Run `yarn check` before you finish. Work is not done until it exits 0.
- Do not add dependencies to `packages/core` (allowlist: zod, pixelmatch, pngjs; pure computation
  only, nothing that touches the OS or network).
- Do not lower a coverage threshold in any `vitest.config.ts` (lines/branches/functions/
  statements: core 98/98/98/98, api 97/94/97/97, cli 95/90/91/94, react-native 98/89/98/94,
  web 97/92/97/96). Thresholds only go up.
- A new or changed architectural rule means a new ADR in `docs/adr/` (template: 0000).
- Do not weaken a guard file to make a check pass: `.dependency-cruiser.cjs`,
  `tsconfig.base.json`, `eslint.config.js`, `vitest.config.ts`, `knip.json`, `lefthook.yml`.
  These are CODEOWNERS-protected; fix the code instead.
- Throw `TargusError` (with a `code`) from services; `apps/api/src/errors.ts` maps codes to HTTP.
- No `any`, no non-null assertions, files <= 300 lines, functions <= 50 lines, complexity <= 10.
- Relative imports name the real file: `./file.ts` or `./file.tsx`, never `.js` (ADR 0017).
- Commits and PR titles are Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`,
  `test:`, `chore:`, `perf:`, `ci:`, `build:`, `style:`, `revert:`).
- PRs are squash-merged, never merged with a merge commit: the PR title becomes the commit on
  `main`, so write it as the Conventional Commit you want in history (ADR 0018).
- User-facing changes to a published package need a changeset (`yarn changeset`).

## Commands

| Command       | What it does                                                        |
| ------------- | ------------------------------------------------------------------- |
| `yarn check`  | typecheck, lint, prettier, depcruise, knip, all tests with coverage |
| `yarn test`   | every workspace's tests with coverage, plus the generator tests     |
| `yarn e2e`    | builds the web app, starts `wrangler dev`, runs Playwright          |
| `yarn format` | Prettier write                                                      |
