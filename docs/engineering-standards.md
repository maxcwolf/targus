# targus engineering standards

The rule for this document: every standard has a guard. A standard that only lives in prose
will be violated by the next engineer or agent under time pressure, so each rule below names
the tool or CI check that enforces it. Prose explains *why*; tooling enforces *what*. If a rule
cannot be enforced automatically, it is written into `AGENTS.md` and the PR template so a
reviewer checks it, and that is listed as a known gap.

`yarn check` runs every guard locally, and CI runs exactly `yarn check` plus the e2e suites.
Local and CI never disagree.

## 1. Architecture

### 1.1 Shape of the system

```
packages/core          pure domain: types, zod schemas, diff, baseline rules   (no I/O)
packages/cli           adapters + orchestration: simctl, channel server, API client, git
packages/react-native  tiny app-side helper (decorator + parameter types)
apps/api               Cloudflare Worker: routes → services → repositories/storage
apps/web               React review UI: features → api-client → components
examples/basic         minimal Expo app used by e2e
```

Dependencies point inward: `apps/*` and `packages/cli` depend on `packages/core`; `core`
depends on nothing in the repo and on no I/O library (pure computation libraries such as zod,
pixelmatch and pngjs are allowed). Nothing depends on an `app`.

### 1.2 Ports and adapters inside each package

- `core` defines the **ports** as TypeScript interfaces (`DeviceDriver`, `StorybookChannel`,
  `ImageStore`, `BuildRepository`, `GitHubClient`, `Clock`). Every piece of logic that matters
  is written against a port, which is what makes it unit-testable with fakes.
- `cli` and `api` provide the **adapters** (`SimctlDriver`, `WsStorybookChannel`, `R2ImageStore`,
  `D1BuildRepository`, `OctokitGitHubClient`). Adapters are thin, contain no business rules,
  and are tested by integration tests against the real thing (a simulator, Miniflare, MSW).
- `api` layering: `routes/` (HTTP concerns only: parse, call one service, map result) →
  `services/` (use-cases, the only place business rules live outside `core`) →
  `repositories/` and `storage/` (D1 and R2 adapters). A route never imports a repository.
- `web` layering: `features/<name>/` own their components, hooks and tests; data enters only
  through `api-client/`, which validates every response with the shared zod schemas. No `fetch`
  outside `api-client/`.

**Guard:** `dependency-cruiser` with a committed `.dependency-cruiser.cjs` that encodes this
graph as `forbidden` rules (core → anything with I/O, routes → repositories, components →
fetch, any cycle). `yarn check` runs `depcruise --validate` and fails on a violation. The
rules file is itself reviewed like code; CODEOWNERS routes changes to it to maintainers.

### 1.3 One source of truth for contracts

All request and response shapes are zod schemas in `packages/core/src/contracts/`. The API
parses input with them, the CLI and web parse output with them, and the OpenAPI document is
generated from them (`@hono/zod-openapi`). A contract change is therefore one diff, and a
mismatch between producer and consumer is a type error, not a runtime surprise.

**Guard:** a contract test in `apps/api` asserts every route's response against its schema;
`tsc` across the workspace fails if a consumer uses a field that no longer exists.

### 1.4 Decisions are recorded

Non-obvious choices (diff on the runner, baseline rules, Cloudflare, no server-side diffing)
live in `docs/adr/NNNN-title.md` using a short template: context, decision, consequences. A PR
that changes an architectural rule adds or supersedes an ADR.

**Guard:** PR template checkbox and reviewer; no automation (known gap).

## 2. Code standards

| Rule | Guard |
| --- | --- |
| TypeScript strict, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` | shared `tsconfig.base.json`; `tsc --noEmit -b` in `yarn check` |
| No `any`, no non-null assertions, no unused code | ESLint `no-explicit-any`, `no-non-null-assertion` as errors; `knip` for unused exports, files and dependencies |
| Small units: files ≤ 300 lines, functions ≤ 50 lines, cyclomatic complexity ≤ 10, nesting ≤ 3 | ESLint `max-lines`, `max-lines-per-function`, `complexity`, `max-depth` as errors |
| No import cycles, no reaching into another package's internals | `import/no-cycle`; packages expose only `src/index.ts`, enforced by `exports` in each `package.json` and dependency-cruiser |
| Errors are typed: services throw subclasses of `TargusError` with a `code`; one middleware maps them to HTTP | ESLint `no-throw-literal`; a unit test asserts every `code` has an HTTP mapping |
| Dates and randomness come from injected `Clock` and `IdGenerator` ports | ESLint `no-restricted-syntax` on `new Date()`, `Date.now()`, `Math.random()`, `crypto.randomUUID()` outside the adapters that implement those ports |
| Formatting is not discussed | Prettier, run by lint-staged on commit and checked in CI |
| Commits and PR titles are Conventional Commits | commitlint on commit and on PR title in CI |
| Every user-facing package change has a changeset | Changesets bot check on PRs |
| No secrets in the tree | gitleaks in CI |
| Dependencies are deliberate | Renovate PRs; `core` may depend only on pure computation libraries (zod, pixelmatch, pngjs), never on anything that touches the OS or network, enforced by a dependency-cruiser allowlist |

### 2.1 Simplicity rules that need judgment

- Prefer a plain function over a class unless there is state to encapsulate. Prefer a
  discriminated union over a class hierarchy.
- Three similar lines beat a premature abstraction; extract on the third real use.
- A module's public surface is what `index.ts` exports. If a test needs an internal, the
  internal is probably a unit that deserves its own module.
- Configuration is validated at startup with zod and typed from the schema. No `process.env`
  reads outside `config.ts` (ESLint `no-restricted-properties`).

## 3. Testing

### 3.1 The pyramid, with ownership

| Layer | What it proves | Where | Runs |
| --- | --- | --- | --- |
| Unit | A pure function or a service against fakes behaves per spec | every package, `*.test.ts` beside the source | every PR, < 30 s |
| Integration | An adapter works against the real dependency it wraps | `cli` (websocket, git, pixelmatch), `api` (Miniflare D1 + R2), `web` (MSW) | every PR, < 3 min |
| Contract | Producers and consumers agree on the wire format | `api` response-schema tests; CLI client tests against recorded API fixtures | every PR |
| End to end | A user-visible flow works across processes | `e2e/` at the repo root | every PR for the no-simulator flows; simulator flow on PRs touching `cli` and nightly |

Coverage thresholds are enforced per package in `vitest.config.ts` and fail the build:
`core` 95% lines and branches, `api` 85%, `cli` 80%, `web` 70%. Thresholds only go up; a PR
that lowers one must say why in the description.

### 3.2 What each package must test

**core.** Unit tests with fixtures for `diffImages`, `compareSnapshot`, `resolveBaseline`,
`buildStatus`, approval carry-forward, and story-id normalisation. Property-based tests with
`fast-check` for the baseline and approval rules (for any build graph, the chosen baseline is an
ancestor; approving then re-running never produces a pending state). Mutation testing with
Stryker runs nightly on `core` only, and a surviving-mutant score below 80% opens an issue.

**cli.** Unit tests for the capture loop against `FakeDriver` and `FakeChannel`, including the
retry and `unstable` paths. Integration tests that start a real channel server and a fake app
client over a real websocket. A real-simulator smoke test against `examples/basic` that captures
three stories and checks image dimensions; this is the only test that needs macOS.

**api.** Integration tests with `@cloudflare/vitest-pool-workers` against local D1 and R2:
build creation, baseline resolution over HTTP, image dedup, review state transitions, check-run
payloads (GitHub mocked with MSW), authorization (org member vs non-member vs no session).
Migration drift test: `drizzle-kit generate` against the schema must produce no new migration.

**web.** Component tests with Testing Library for the snapshot viewer modes and review actions.
Feature tests with MSW for the build page (filters, approve-all, keyboard navigation).

**react-native.** Unit tests for the decorator with `@testing-library/react-native`.

### 3.3 End-to-end suites

- `e2e/review.spec.ts` (Playwright): seed a local Worker with a build that has two changed
  stories, sign in through a stubbed GitHub OAuth, approve one and deny one, assert the check-run
  calls the GitHub mock received and the build status shown. Runs on every PR.
- `e2e/capture.spec.ts` (macOS only): build `examples/basic` once per fingerprint, run
  `targus run` against the local Worker, assert the build appears with the expected story ids.
  Runs on PRs that touch `packages/cli` or `examples/`, and nightly.
- `e2e/pilot-canary` (manual workflow): run the CLI against the pilot app's cached app on a maintainer's
  machine or CircleCI and post the summary. Not a gate; a feedback loop.

### 3.4 Test hygiene rules

- No retries in unit, integration or contract tests. E2E may retry once; a test that needed the
  retry is flagged in the report and quarantined within a week or fixed.
- No network in unit tests (`vitest` runs with `--no-network` shim; MSW `onUnhandledRequest: 'error'`).
- Fakes live beside the port they fake (`core/src/ports/device-driver.fake.ts`) and are the
  only test doubles; no ad-hoc mocking of modules with `vi.mock` except at adapter boundaries.
- Fixtures are small and named for what they show (`two-changed-one-new.json`), never dumps.

## 4. Guards against drift by engineers and agents

The honest answer to "how do we stop someone going around the standards" is: make the
standard the path of least resistance, and make CI the thing that says no.

1. **One command.** `yarn check` = typecheck + lint + prettier check + depcruise + knip + unit
   and integration tests with coverage. It is what pre-commit runs on staged packages and what
   CI runs. An agent that "finishes" without a green `yarn check` has not finished.
2. **Branch protection.** `main` requires: `check`, `e2e-review`, PR title lint, changeset
   check, one human approval, linear history. Admins are not exempt.
3. **CODEOWNERS.** `.dependency-cruiser.cjs`, `tsconfig.base.json`, `eslint.config.js`,
   `vitest.config.ts` thresholds, `docs/adr/`, and `AGENTS.md` require a maintainer review.
   Loosening a guard is a visible, reviewed act.
4. **Scaffolding over instructions.** `yarn new:adapter <port> <name>` and `yarn new:route <name>`
   generate the files in the right layer with a test beside them. The easy way is the right way.
5. **AGENTS.md** at the root (imported by `CLAUDE.md` via `@AGENTS.md`) states, in under 80 lines: the layer
   map, where new code goes, the ports list, "run `yarn check` before you finish", "do not add
   dependencies to core", "do not lower a coverage threshold", "new rule means new ADR". Agents
   read it on every session; its content is tested by the same CI gates, so an agent that ignores
   it still cannot merge.
6. **Review checklist in the PR template.** Three questions a reviewer answers: does this
   change a port or contract (then is there a test and an ADR), does it add a dependency (why),
   does it touch a guard file (why). Short enough to be read.
7. **Nightly drift jobs.** Mutation score on `core`, Renovate, and a `knip` run that opens an
   issue for new dead code, so slow rot is surfaced rather than discovered.

Known gaps that rely on humans: ADR discipline, naming quality, and whether a test actually
asserts the behaviour rather than the implementation. Review covers these.

## 5. Repository layout

```
targus/
  AGENTS.md  CLAUDE.md (@AGENTS.md)
  package.json  .yarnrc.yml  tsconfig.base.json  eslint.config.js
  .dependency-cruiser.cjs  knip.json  .changeset/  lefthook.yml  renovate.json
  .github/
    workflows/check.yml  e2e-review.yml  e2e-capture.yml  nightly.yml  release.yml
    PULL_REQUEST_TEMPLATE.md  CODEOWNERS
  docs/  plan.md  engineering-standards.md  spike-m0.md  adr/
  packages/core  packages/cli  packages/react-native
  apps/api  apps/web
  examples/basic
  e2e/
```

Tooling choices: Yarn 4 workspaces (node-modules linker, matching the pilot app), TypeScript 5.x project references, Vitest, Playwright,
ESLint flat config with `typescript-eslint`, `eslint-plugin-import-x`, `eslint-plugin-vitest`,
Prettier, dependency-cruiser, knip, Changesets, lefthook, commitlint, Renovate, gitleaks.
Every one of these is free and runs on GitHub Actions' Linux runners; only the simulator e2e
needs macOS.
