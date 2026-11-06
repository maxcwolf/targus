# targus engineering standards

The rule for this document (ADR 0009): every standard has a guard. A standard that lives only
in prose gets violated by the next engineer or agent who is short of time. So each rule names the
file or command that enforces it. The prose explains _why_; the tooling enforces _what_.

The document has two parts:

- **Enforced today** (sections 1 to 5). Each rule here names its enforcing config or command,
  and each was checked against the repository on 2026-11-06. A rule marked **Review only** has
  no automated guard: a reviewer checks it, prompted by `AGENTS.md` or the PR template, and it
  is listed as a known gap.
- **Planned** (section 6). Intent that is written down but not built. Nothing in section 6
  stops a change today. When a planned guard lands, move its rule up into sections 1 to 5 and
  name the file that enforces it.

Code comments cite sections 1.2, 2, 3.1, 3.2, 3.3, 3.4, 4.3 and 4.4 by number, so keep those
numbers stable.

# Enforced today

## 1. Architecture

### 1.1 Shape of the system

```
packages/core          pure domain: types, zod contracts, ports, diff, baseline rules   (no I/O)
packages/cli           adapters + orchestration: simctl, channel server, git, API client
packages/react-native  app-side helper: withTargus decorator, parameters.targus types
apps/api               Cloudflare Worker: routes -> services -> repositories/ + storage/
apps/web               React review UI: features/ -> api-client/ (components/ are presentational)
e2e/                   Playwright suites against a local Worker
scripts/               the yarn new:* generators and their tests
spike/                 the M0 spike, kept as written (docs/spike-m0.md)
```

The workspaces are listed in the root `package.json` (`packages/*`, `apps/*`, `e2e`).

Dependencies point inward: `apps/*` and `packages/cli` depend on `packages/core`; `core`
depends on no other workspace and on no I/O library; nothing depends on an app.

**Guard:** `.dependency-cruiser.cjs`, run by `yarn depcruise` in `yarn check`:

- `core-no-other-workspaces`: core imports nothing outside `packages/core/`.
- `core-no-node-builtins`: core imports no Node builtin.
- `core-dependency-allowlist`: core's non-test source may import only zod, pixelmatch and pngjs.
- `no-importing-apps` and `apps-do-not-import-each-other`.

### 1.2 Ports and adapters inside each package

- `core` defines the **ports** as TypeScript interfaces in `packages/core/src/ports/`:
  `DeviceDriver`, `StorybookChannel`, `ImageStore`, `BuildRepository`, `GitHubClient`, `Clock`
  and `IdGenerator`. Logic is written against a port so that fakes can test it.
- `cli` and `api` provide the **adapters**: `SimctlDriver` and `WsStorybookChannel`
  (`packages/cli/src/adapters/`), `R2ImageStore` (`apps/api/src/storage/`), `D1BuildRepository`
  (`apps/api/src/repositories/`), `OctokitGitHubClient`, `systemClock` and `cryptoIdGenerator`
  (`apps/api/src/adapters/`). **Review only:** that an adapter is thin and holds no business rule.
- `api` layering: `routes/` (HTTP only: parse, call a service, map the result) →
  `services/` (use-cases, the only place rules live outside `core`) → `repositories/` and
  `storage/` (D1 and R2 adapters).
- `api` authentication is middleware (`apps/api/src/middleware/auth.ts`): `projectAuth` for the
  CLI's bearer token, `sessionAuth` for the reviewer's cookie. `sessionAuth` also refuses a
  cookie-authenticated write that is not same-origin, and session ids are stored only as
  SHA-256 hashes (ADR 0015). `yarn new:route` generates a route behind `sessionAuth`.
- `cli` starts every subprocess through `packages/cli/src/adapters/exec.adapter.ts` and makes
  every API request through `TargusApiClient` (`api-client.adapter.ts`). Both apply a timeout
  when the caller gives none, and the client retries idempotent requests on network errors,
  timeouts, 429 and 5xx.
- `web` layering: `features/<name>/` own their components, hooks and tests; data enters only
  through `api-client/`, and `components/` are presentational.

**Guard:** `.dependency-cruiser.cjs`:

- `api-routes-not-repositories`: a route never imports `repositories/`, `storage/` or `db/`.
- `api-layers-point-down`: nothing below `routes/` imports a route.
- `api-adapters-not-services`: repositories and storage never import a service.
- `web-features-use-api-client-index`: the web app reaches `api-client/` only through its
  `index.ts`.
- `web-components-are-presentational`: `components/` imports neither `api-client/` nor
  `features/`.
- `no-test-code-in-production`, `not-to-unresolvable`, `not-to-dev-dep`.

`eslint.config.js` (`targus/web`) bans the `fetch` and `XMLHttpRequest` globals in
`apps/web/src/` outside `api-client/`, which dependency-cruiser cannot see.

The same-origin rule is tested in `apps/api/src/services/origin.service.test.ts` and through
the routes; the timeouts and retries in `exec.adapter.test.ts`, `api-client.retry.test.ts` and
`retry.test.ts`.

**Review only:** that a route calls exactly one service; that a new review route uses
`sessionAuth`; that nothing in the CLI spawns a process or calls `fetch` outside those two
adapters.

### 1.3 One source of truth for contracts

All request and response shapes are zod schemas in `packages/core/src/contracts/`, exported
from `@targus/core`. The API parses input with them. The CLI (`TargusApiClient`) and the web
`api-client/` parse responses with them (the web's request helper in
`apps/web/src/api-client/http.ts` parses each body with the schema it is given). A contract change is one diff in core. When a consumer
uses a field that no longer exists, the build fails on a type error.

**Guard:** `yarn typecheck` (`tsc -b` over every workspace) fails when a consumer uses a field
that no longer exists. `packages/core/src/contracts/contracts.test.ts` tests the schemas
themselves. Several API route tests (for example `apps/api/src/routes/builds.test.ts`) parse
responses with the core schema. Nothing checks that every route has such a test (6.6).

### 1.4 Decisions are recorded

Non-obvious choices live in `docs/adr/NNNN-title.md`, following
[`docs/adr/0000-template.md`](adr/0000-template.md); the index and statuses are in
[`docs/adr/README.md`](adr/README.md). A PR that changes an architectural rule adds an ADR, or
supersedes or amends one.

**Review only:** the first item of `.github/PULL_REQUEST_TEMPLATE.md` asks about ports and
contracts, and `AGENTS.md` says "a new or changed architectural rule means a new ADR". Nothing
checks either.

## 2. Code standards

| Rule | Guard |
| --- | --- |
| TypeScript `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch` | `tsconfig.base.json`, which every workspace's compiled tsconfig extends; `yarn typecheck` (`tsc -b`) |
| No `any`, no non-null assertions | ESLint `@typescript-eslint/no-explicit-any` and `no-non-null-assertion` as errors (`eslint.config.js`, `targus/standards`); `typescript-eslint` `strictTypeChecked` |
| No unused files, exports or dependencies | `yarn knip` with `knip.json` |
| Small units: files ≤ 300 lines, functions ≤ 50 lines (blank lines and comments not counted), cyclomatic complexity ≤ 10, nesting ≤ 3 | ESLint `max-lines`, `max-lines-per-function`, `complexity`, `max-depth` as errors |
| No import cycles | ESLint `import-x/no-cycle`, and dependency-cruiser `no-circular` |
| A package is reached only through its entry point | each package's `exports` (`development` → `src/index.ts`, else `dist/`, ADR 0010); dependency-cruiser `only-public-package-entry` |
| Only `Error` objects are thrown | ESLint `@typescript-eslint/only-throw-error` |
| Every `TargusError` code has an HTTP status | `statusByCode` in `apps/api/src/errors.ts` `satisfies Record<TargusErrorCode, …>`, so `yarn typecheck` fails on a missing code; `apps/api/src/errors.test.ts` checks every code maps to an error status |
| Time and randomness come from the `Clock` and `IdGenerator` ports | ESLint `no-restricted-syntax` on `new Date()`, `Date.now()`, `Math.random()` and `*.randomUUID()`, switched off only in `**/adapters/**` and `**/*.adapter.ts` |
| `process.env` is read only in a `config.ts` | ESLint `no-restricted-properties`, switched off only in `**/config.ts` |
| Type-only imports are marked | ESLint `@typescript-eslint/consistent-type-imports` |
| Relative imports name the real file (`./file.ts`, `./file.tsx`), never `.js` | ESLint `no-restricted-imports` on `**/*.{ts,tsx,mts}` (`eslint.config.js`, `targus/import-extensions`). `tsconfig.base.json` sets `allowImportingTsExtensions`, and each package's `tsconfig.lib.json` sets `rewriteRelativeImportExtensions`, so `dist/` keeps `.js` paths (ADR 0017) |
| No focused or skipped tests | ESLint `vitest/no-focused-tests` and `vitest/no-disabled-tests` on `**/*.test.{ts,tsx}`. In Playwright, `forbidOnly` is on in CI (`e2e/playwright.config.ts`) |
| React hooks rules in the web app | `eslint-plugin-react-hooks` `recommended-latest` on `apps/web/src/` |
| Formatting is not discussed | Prettier (`.prettierrc.json`): the lefthook `pre-commit` job writes staged files, and `yarn format:check` in `yarn check` fails on unformatted code. `docs/` and `spike/` are in `.prettierignore`. `.claude/` is in `.prettierignore` and the ESLint ignores because Claude Code keeps git worktrees there, each a full repo copy with its own `node_modules`, which would otherwise be linted and exhaust Node's heap |
| Commit messages are Conventional Commits | commitlint (`commitlint.config.js`), run by the lefthook `commit-msg` hook |
| PR titles are Conventional Commits | the `pr-title` job in `.github/workflows/check.yml` |
| Every commit that lands on `main` is a Conventional Commit | the repository allows squash merges only, and the squash commit's subject is the PR title, which the `pr-title` job checks (ADR 0018). This is a repository setting, not a file in the tree (section 4.2) |
| No secrets in the tree | the `gitleaks` job in `.github/workflows/check.yml`, with `.gitleaks.toml` |
| `core` depends only on pure computation libraries (zod, pixelmatch, pngjs) | dependency-cruiser `core-dependency-allowlist` and `core-no-node-builtins` |

These rows apply to the repository as configured today. Two limits apply to all of them. Hooks
can be skipped with `--no-verify`. And a red CI job does not block a merge until branch
protection exists (section 4.2).

**Review only:** services throw `TargusError` with a `code`, not some other `Error` (the lint
above only requires an `Error`). Each user-facing change to a published package has a
changeset (`AGENTS.md` and the PR template's last checkbox; no CI check, 6.4). A new dependency
must be justified (the PR template's second question).

### 2.1 Simplicity rules that need judgment

All **Review only**:

- Prefer a plain function over a class unless there is state to encapsulate. Prefer a
  discriminated union over a class hierarchy.
- Three similar lines beat a premature abstraction; extract on the third real use.
- A module's public surface is what `index.ts` exports. If a test needs an internal, the
  internal is probably a unit that deserves its own module.
- Configuration is validated with zod in `config.ts` and typed from the schema (the
  `process.env` half of this rule is enforced, see section 2).

## 3. Testing

### 3.1 The layers, as built

| Layer | What it proves | Where | Runs |
| --- | --- | --- | --- |
| Unit | A pure function or a service against fakes behaves per spec | every workspace, `*.test.ts(x)` beside the source | `yarn test`, in `yarn check` |
| Integration | An adapter works against the real dependency it wraps | `api`: inside workerd against local D1 and R2 (`@cloudflare/vitest-plugin`); `cli`: a real websocket (`ws-channel.adapter.test.ts`) and real `git` in a sandbox (`git.sandbox.ts`); `web`: jsdom with MSW | `yarn test`, in `yarn check` |
| Contract | Producers and consumers agree on the wire format | `packages/core/src/contracts/contracts.test.ts`; API route tests that parse responses with the core schema | `yarn test`, in `yarn check` |
| End to end | A user-visible flow works across processes | `e2e/` (Playwright) | `yarn e2e`, in `.github/workflows/e2e-review.yml` |
| Generators | `yarn new:*` output compiles and passes lint | `scripts/*.test.mjs` (`node --test`) | `yarn test:scripts`, in `yarn test` |

`yarn test` runs `vitest run --coverage` in every workspace that has a `test` script. CI's
`check` job runs `yarn check` on every pull request and every push to `main`, with a 15-minute
job timeout. The `e2e-review` job has a 20-minute timeout.

**Coverage thresholds** are set per workspace in `thresholds` of `packages/core`,
`packages/cli`, `packages/react-native`, `apps/api` and `apps/web` `vitest.config.ts`, for lines,
branches, functions and statements. Falling under them fails `yarn test`. The numbers are set
in those files; `AGENTS.md` repeats them, and the files are what runs. `e2e/` and `scripts/`
have no coverage threshold.

**Review only:** thresholds only go up. `**/vitest.config.ts` is in `.github/CODEOWNERS`
(see 4.3 for what that does and does not do), the PR template asks for a justification, and
`AGENTS.md` says so.

### 3.2 What each package tests today

**core.** Fixture-based unit tests for `diffImages`, `isBlankPng`, `compareSnapshot`,
`resolveBaseline`, `buildStatus`, `acceptedImageHash`, `libraryStories` and the contracts.
`fast-check` property tests cover `resolveBaseline` (the result is null or a successful
candidate on the earliest sha that has one) and `compareSnapshot` (an approved hash pair is
never left pending; a build whose non-error captures are all approved is never pending).

**cli.** The capture loop runs against `createFakeDeviceDriver` and `createFakeStorybookChannel`
from `packages/core/src/ports/`, covering the doubled-settle retry and the `unstable` path. The
channel server is tested over a real websocket. The git adapter is tested against real `git` with
inherited `GIT_*` variables removed. The API client is tested against a stubbed `fetch`, and
its timeouts and retries with an injected wait, so no test sleeps
(`api-client.retry.test.ts`, `retry.test.ts`). `src/program.run-failures.test.ts` runs
`targus run` from argv to exit code and stderr for the three whole-run failures: the app never
connects, an upload fails, submitting results fails. A
real-simulator test (`src/commands/capture.simulator.test.ts`) runs only when
`TARGUS_SIMULATOR_UDID` and `TARGUS_APP` are set. CI sets neither, so it never runs there (6.2).

**api.** Tests run inside workerd with the real local D1 and R2 bindings from `wrangler.jsonc`,
with the committed migrations applied by `test/apply-migrations.ts`. They cover routes,
services and repositories: build creation, baseline resolution, image upload records,
results, review state, retries and races, builds paging, hashed sessions and the same-origin
rule for cookie-authenticated writes. One paging suite (`test/support/build-paging-suite.ts`)
runs against both the D1 build repository and its in-memory double, so the two cannot drift.
GitHub is a recording stub
(`test/support/github-recorder.ts`), not MSW. Authorization covers org member, non-member,
no session and cross-org (`src/routes/cross-org.test.ts`, `src/services/cross-org.test.ts`).
Full-flow tests live in `src/flows/`. The migration drift test
(`test/node/migration-drift.test.ts`, run by the workspace's `test:drift` as part of its `test`)
fails when `drizzle-kit generate` against `src/db/schema.ts` would produce a new migration.

**web.** Testing Library component and feature tests under `src/features/` and
`src/components/`, with network calls answered by MSW handlers (`src/test/msw.ts`). They
include an expired session and a failed review action
(`src/features/auth/session-expiry.test.tsx`), builds paging
(`src/features/projects/builds-paging.test.tsx`) and the crash panel
(`src/components/components.test.tsx`).

**react-native.** Unit tests for `parameters.targus` and for the `withTargus` decorator,
rendered with `react-test-renderer` in Node.

### 3.3 End-to-end suites

`yarn e2e` builds the CLI and the web app. Playwright's `webServer` then migrates a fresh local
D1 and starts `wrangler dev`, with a stubbed GitHub (`e2e/support/github-stub.ts`) behind the
Worker's GitHub origins. `.github/workflows/e2e-review.yml` runs it on every pull request and
push to `main`, on Linux, with full git history.

- `e2e/review.spec.ts`: builds published by the CLI, sign-in through the stubbed GitHub OAuth,
  approve-all on the first build so it becomes the baseline, then a changed story on a PR
  build denied and approved, with the check-run calls the stub received asserted after each
  decision.
- `e2e/run.spec.ts`: the built `targus run` against the local Worker from a fixture capture,
  checking the build, its snapshots and the stored PNGs.

No e2e suite drives a simulator (6.2).

### 3.4 Test hygiene rules

- E2E retries once in CI and never locally (`retries` in `e2e/playwright.config.ts`).
  **Review only:** a test that needed the retry is fixed or quarantined within a week.
- **Review only:** no retries in unit, integration or contract tests. No Vitest config sets
  `retry`, but nothing stops a test from setting it.
- In `apps/web`, a request without an MSW handler fails the test (`onUnhandledFrame: 'error'`
  in `apps/web/src/test/setup.ts`). The other workspaces have no network guard (6.10).
- **Review only:** fakes of a port live beside it (`packages/core/src/ports/*.fake.ts`) and are
  preferred to any other double. Other hand-written doubles exist outside the ports:
  `apps/api/test/support/` (in-memory repositories, the GitHub recorder and stub, a fake OAuth),
  `packages/cli/src/run/targus-api.fake.ts` and `packages/cli/src/capture/solid-png.fake.ts`.
  No test uses `vi.mock` today; nothing enforces that.
- **Review only:** fixtures are small and named for what they show, never dumps.

## 4. Guards against drift by engineers and agents

Make the standard the path of least resistance, and make CI the thing that says no. Today CI
says no only in the sense that its jobs go red. Section 4.2 explains why that does not yet stop
a merge.

### 4.1 One command

`yarn check` (root `package.json`) runs `typecheck`, `lint`, `format:check`, `depcruise`,
`knip` and `test`, which includes the generator tests. Then:

- `.github/workflows/check.yml` job `check` runs `yarn install --immutable` and exactly
  `yarn check`. The same workflow runs `gitleaks` and, on pull requests, `pr-title`.
- `.github/workflows/e2e-review.yml` runs `yarn e2e`.
- `lefthook.yml`, installed by the root `postinstall`: `pre-commit` runs Prettier and ESLint
  with `--fix` on staged files; `commit-msg` runs commitlint; `pre-push` runs `yarn check`.

`AGENTS.md` says work is not done until `yarn check` exits 0.

### 4.2 Branch protection

Not configured. On 2026-11-06 the GitHub API answered "Branch not protected" for `main`, and the
repository had no rulesets. A pull request can therefore merge with any CI job red and without
review. The intended settings are in 6.3.

One merge setting is in place. Since 2026-11-06 the repository allows squash merges only: merge
commits and rebase merges are switched off, and the squash commit takes the PR title as its
subject and the PR's commit messages as its body (ADR 0018). So history on `main` is linear,
and each commit there carries a title the `pr-title` job has checked. The setting lives in the
repository's GitHub settings (`allow_squash_merge`, `allow_merge_commit`, `allow_rebase_merge`,
`squash_merge_commit_title`), not in a file, so nothing in the tree shows a change to it.

### 4.3 CODEOWNERS

`.github/CODEOWNERS` assigns `@maxcwolf` to `.dependency-cruiser.cjs`, `tsconfig.base.json`,
`eslint.config.js`, `**/vitest.config.ts`, `docs/adr/`, `AGENTS.md`, `lefthook.yml`,
`knip.json` and `.github/`. GitHub requests that owner's review on a pull request that touches
those paths. The request blocks a merge only when branch protection requires code-owner review,
and it does not (4.2). While the owner is also the only author, nobody else is ever asked to
review. So loosening a guard is visible in the diff, but no one else has to approve it.

### 4.4 Scaffolding over instructions

`yarn new:adapter <port> <name>` (`scripts/new-adapter.mjs`) and `yarn new:route <name>`
(`scripts/new-route.mjs`) write the files in the right layer with a test beside them.
`scripts/generators.test.mjs`, run by `yarn test:scripts`, generates each into a scratch copy and
checks that the output type-checks and lints.

### 4.5 AGENTS.md

`AGENTS.md` at the root (`CLAUDE.md` contains only `@AGENTS.md`) lists the layer map, where new
code goes, the ports, and the rules above in short form. Nothing checks `AGENTS.md` against the
guard files; when they disagree, the guard files are what runs.

### 4.6 Review checklist in the PR template

`.github/PULL_REQUEST_TEMPLATE.md` asks three questions: does this change a port or contract
(then is there a test and an ADR), does it add a dependency (why), and does it touch a guard
file (why). A last checkbox covers `yarn check` and a changeset. **Review only:** nothing checks
that the boxes are answered.

### 4.7 Known gaps that rely on humans

The **Review only** items above, plus: naming quality, and whether a test asserts the behaviour
rather than the implementation.

## 5. Repository layout

```
targus/
  AGENTS.md  CLAUDE.md (@AGENTS.md)  README.md
  package.json  .yarnrc.yml  .nvmrc  yarn.lock
  tsconfig.base.json  tsconfig.json  eslint.config.js  .prettierrc.json  .prettierignore
  .dependency-cruiser.cjs  knip.json  lefthook.yml  commitlint.config.js
  .gitleaks.toml  renovate.json  .changeset/
  .github/
    workflows/check.yml  e2e-review.yml
    PULL_REQUEST_TEMPLATE.md  CODEOWNERS
  docs/  plan.md  engineering-standards.md  spike-m0.md  adr/
  packages/core  packages/cli  packages/react-native
  apps/api  apps/web
  e2e/  scripts/  spike/
```

Tooling in use: Yarn 4 workspaces (node-modules linker), TypeScript 6 with project references
(`eslint.config.js` explains why not 7), Vitest, `@cloudflare/vitest-plugin` for the Worker,
Testing Library and MSW for the web app, Playwright, ESLint flat config with `typescript-eslint`,
`eslint-plugin-import-x`, `@vitest/eslint-plugin` and `eslint-plugin-react-hooks`, Prettier,
dependency-cruiser, knip, Changesets (CLI only), lefthook, commitlint, gitleaks. All CI runs on
GitHub Actions' Linux runners.

# Planned

## 6. Not built yet

Each item says where the intent came from and what it would take. Nothing here is a
guard yet.

### 6.1 `examples/basic`

A minimal Expo app with a few stories, used by targus's own e2e and simulator tests. It does
not exist. The e2e suites use a fixture capture (`targus fixture-capture`) instead of a real
app.

### 6.2 Real-simulator tests in CI

- `e2e/capture.spec.ts` (macOS only) and a `e2e-capture.yml` workflow: build `examples/basic`
  once per fingerprint, run `targus run` against the local Worker, and assert that the build
  appears with the expected story ids. Run on PRs that touch `packages/cli` or `examples/`,
  and nightly.
- A cli smoke test against `examples/basic` that captures three stories and checks image
  dimensions. Today `capture.simulator.test.ts` exists but runs only by hand.
- `e2e/pilot-canary`, a manual workflow that runs the CLI against the pilot app's cached app and
  posts the summary. A feedback loop, not a gate.

These were planned on the assumption that the repository is public, so that macOS runner
minutes are free (plan.md section 10). The repository is private, so a macOS job costs minutes
or needs a self-hosted runner.

### 6.3 Branch protection on `main`

Require the `check`, `gitleaks`, `pr-title` and `e2e-review` jobs, a changeset check (6.4), one
human approval and code-owner review (which makes 4.3 a gate), with admins not exempt. Linear
history already follows from squash-only merges (4.2); a "require linear history" rule would
keep it true if the merge settings were ever changed.

### 6.4 Changeset check on pull requests

The Changesets bot or a CI step (for example `changeset status --since=origin/main`) that fails
a PR changing a published package (`@targus/core`, `@targus/cli`, `@targus/react-native`)
without a changeset. Today `.changeset/config.json` and the `yarn changeset` script exist, and
nothing checks.

### 6.5 Release workflow

`.github/workflows/release.yml`: Changesets version PRs and npm publishing of the three public
packages. Nothing publishes them today.

### 6.6 Contracts: OpenAPI and an every-route response test

- Generate an OpenAPI document from the core contracts (`@hono/zod-openapi`). The dependency
  is not installed and no document exists.
- A contract test in `apps/api` that asserts every route's response against its schema, so a
  route without such a test fails the suite.
- CLI client tests against recorded API fixtures instead of hand-written stub responses.

### 6.7 Mutation testing

Stryker on `packages/core`, nightly. A mutation score below 80% opens an issue. Not installed.

### 6.8 Nightly drift jobs

`.github/workflows/nightly.yml`: mutation score on `core` (6.7), and a `knip` run that opens an
issue for new dead code, so slow rot is surfaced rather than discovered. There is no nightly
workflow.

### 6.9 Renovate

`renovate.json` is committed. Whether the Renovate app is installed on the repository was not
verified, and no Renovate pull request has been opened yet. Until one has, treat dependency
updates as manual.

### 6.10 No network in Node tests

A guard that fails any unit test in `core`, `cli`, `react-native` and `api` that opens a network
connection, like MSW does for `apps/web`.

### 6.11 Test-speed budgets

Unit tests under 30 s and integration tests under 3 minutes per PR. Only the CI job timeouts
(3.1) exist.

### 6.12 Decorator tests with `@testing-library/react-native`

The decorator is tested with `react-test-renderer` today (`packages/react-native/vitest.config.ts`
explains why); the plan is to move to `@testing-library/react-native`.

### 6.13 CODEOWNERS teams

Move the owners in `.github/CODEOWNERS` to an org team when the repository moves to an org, so
a guard change needs someone other than its author.
