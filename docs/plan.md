# targus — visual review for React Native on-device Storybook

Status: v1 plan. Written 2026-11-04. Brought in line with the repository on 2026-11-06:

- **Built** means the code is on `main`.
- **Partly built** and **Not built** say what is missing.
- Items marked **Assumption** are defaults that are still open to change.

Section numbers and the rule numbers in section 6 are cited from code comments, so keep them
stable. The guards are in [engineering-standards.md](engineering-standards.md); its Planned
section lists the ones not built.

## 1. Goal

A Chromatic-equivalent for the _native_ Storybook of a React Native app. On every pull request
and every push to `main`, CI renders each story in an iOS simulator, screenshots it, compares
it with the accepted baseline, and publishes the result as a GitHub check. Engineers sign in
with GitHub, review each changed story side by side with its baseline, and approve or deny. The
check stays pending until every change is approved, so the repo can require it before merge.

First consumer: `example-org/example-app`. Design for any repo in the example-org org now, and for other
GitHub orgs later without a rewrite. The proof of concept before the pilot app runs on a repository
owned by a personal account (ADR 0012).

## 2. Agreed decisions

| Decision | Choice |
| --- | --- |
| Backend | Hosted service with a Chromatic-like review UI (ADR 0001) |
| Platforms (v1) | iOS only, one simulator, light mode, default font scale (ADR 0006) |
| Hosting | Cloudflare: one Worker (API + static web app), R2 (images), D1 (metadata) (ADR 0002) |
| Tenancy | Org-scoped data model from day one (ADR 0007); a personal account works as a single-member org (ADR 0012) |
| App binary | Native simulator app cached by Expo fingerprint; JS rebundled per run (ADR 0005) |
| Diffing | The CLI computes the diff on the CI runner; the server classifies each story from it (ADRs 0003, 0016) |
| Gating | GitHub check run `targus/ios` pending until all changes are approved; passes when clean |
| CI runner (the pilot app) | CircleCI macOS, where the pilot app already builds and boots simulators |
| Capture | Full simulator screen via `simctl io screenshot`, status bar overridden (ADR 0006) |
| Triggers | PR builds and `main` builds; main auto-accepts PR approvals (ADR 0004) |
| Free tier | Applies to hosted services; CI minutes are the pilot app's existing CircleCI plan |

## 3. Non-goals for v1

- Android, dark mode, font-scale modes, iPad. The data model carries a `variant` key so these
  slot in later. Every snapshot is stored with variant `default` today.
- TurboSnap-style "only changed stories". Every story is captured every run.
- Chromatic's per-branch baseline ancestry across arbitrary branches. v1 baselines come from
  the PR's merge-base with the default branch.
- Comments, Slack notifications, Figma links, interaction tests.
- A self-serve project-creation UI. Projects are created by an admin API call
  (`POST /api/admin/projects`).

## 4. How it works end to end

```
Consumer's CI macOS job (the pilot app: not built yet)      targus service (Cloudflare)
───────────────────────────────                      ───────────────────────────
1. fingerprint ─► restore cached .app
   (miss: eas build --local, save cache)
2. expo export:embed with Storybook on
   ─► swap main.jsbundle + assets into .app
3. targus run                                        (built)
   ├─ boot simulator, override status bar
   ├─ install + launch app (Storybook UI)
   ├─ host the Storybook channel on ws://localhost:7007
   ├─ ask app for story index
   ├─ for each story: select ─► wait rendered ─► settle ─► screenshot ─► hash
   ├─ POST /api/builds (git metadata + snapshot list) ─► resolve baseline build
   │                                     ◄── baseline hashes + hashes this project has not uploaded
   ├─ download baselines that differ, diff locally (pixelmatch)
   ├─ PUT missing images + diff images to R2 (via API)
   └─ POST results (diff ratios) ──────────────────► classify each story, store,
                                                      create GitHub check run
                                                      (in_progress: "7 changes to review")

Engineer opens check link ─► web app (GitHub login) ─► approve / deny
                                                      ─► check run updated (success / failure)
Merge to main ─► main build ─► changes with a matching PR approval auto-accept
                              ─► main build becomes the next baseline
```

Steps 1 and 2 belong to the consumer's CI (section 8). They were proven by hand in the capture
spike (`spike/rebundle.sh`); targus does not ship them.

### Why diffing happens on the CI runner, not the server

Workers on the free plan have a small per-request CPU budget. Decoding two 3x retina PNGs and
running pixelmatch would exceed it. The CI runner is a macOS machine with idle cores, so the
CLI downloads only the baselines whose hash differs (usually a handful), diffs there, and
uploads results plus diff images (ADR 0003).

The server stays a thin metadata and storage layer, but it does not take the CLI's word for
the outcome. It derives each story's baseline from the baseline build, and it classifies each
story with `compareSnapshot` using its own `DIFF_THRESHOLD` and the project's approvals. It
accepts only image hashes the project itself uploaded (ADRs 0014, 0016). What it still trusts
is what only the runner can measure: the diff ratio, the `unstable` and `blank` flags, and the
render error text.

Trade-off: a build cannot be re-diffed without re-running the capture.

## 5. Components

Monorepo, TypeScript end to end, Yarn 4 workspaces (the same toolchain the pilot app uses).

```
targus/
  packages/core        Built. Pure logic, no I/O: types, zod contracts, ports, diff, baseline
                       resolution, approval carry-forward, build status.
  packages/cli         Built. `targus` binary: device driver (simctl), Storybook channel server,
                       capture loop, git metadata, API client, local HTML report.
  packages/react-native  Partly built. `withTargus` decorator (an error boundary that reports
                       render errors, and a reporter for `parameters.targus` delay and skip,
                       over the channel). Reduced motion and the locked date are not built
                       (section 7).
  apps/api             Built. Cloudflare Worker: Hono router, Drizzle + D1, R2 bindings, GitHub
                       App login and check runs. Also serves the built web app as static assets.
  apps/web             Built. React + Vite review UI (TanStack Router + Query), served by apps/api.
  e2e/                 Built. Playwright suites against a local Worker with a stubbed GitHub.
  examples/basic       Not built. Minimal Expo app for targus's own simulator tests.
  docs/
```

Tooling: strict TypeScript, Vitest, ESLint + Prettier, Changesets for versioning (no release
workflow yet), Wrangler for deploys, `@cloudflare/vitest-plugin` for API tests against local D1
and R2. Architecture rules, code standards, the test layers and the guards that enforce them
are in [engineering-standards.md](engineering-standards.md).

### 5.1 CLI (`packages/cli`)

Commands (built; `packages/cli/README.md` has every flag):

- `targus capture --udid <id> --app <path.app> --out <dir>` captures every story to a directory
  with a `manifest.json`. Works offline. Useful on its own.
- `targus compare --current <dir> --baseline <dir> --out <dir>` produces a local HTML report.
  This replaces the March 2026 `.visual-screenshots` experiment.
- `targus run` does capture (or `--from-capture <dir>`), baseline lookup, diff, upload and
  publish in one go. This is what CI calls. The token comes only from `TARGUS_TOKEN`.

Internals:

- `DeviceDriver` port: `boot`, `install(appPath)`, `launch(bundleId, env)`,
  `isAppRunning(bundleId)`, `setStatusBar`, `screenshot`, `shutdown`. One implementation in v1, `SimctlDriver`. An `AdbDriver` lands with
  Android.
- `StorybookChannel` port, implemented by `WsStorybookChannel`: a WebSocket server speaking
  Storybook's channel protocol. Storybook RN 10's app connects to it when `enableWebsockets` is
  on. The CLI emits `setCurrentStory` and waits for `storyRendered` or `storyUnchanged`; it
  asks for the index with `RN_GET_INDEX`. This was proven in the capture spike
  ([capture-spike.md](capture-spike.md)), and the deep-link fallback is no longer planned.
  `storyRendered` fires on React commit, not on paint, so the settle delay below is
  load-bearing.
- Settle logic (built): after `storyRendered`, wait `--settle` (default 300 ms) and screenshot.
  Then screenshot again after `--stability-gap` (default 150 ms) and compare. If the two
  differ, retry with a doubled settle up to `--attempts` (default 3) and mark the story
  `unstable`, rather than silently diffing noise. `unstable` never blocks the check.
  Per-story `parameters.targus.delay` and `parameters.targus.skip` (built, ADR 0022): the
  `withTargus` decorator reports them over the channel once the story commits; `delay` (0 to
  10 000 ms) replaces `--settle` for that story, and a `skip` story is neither captured nor
  submitted. An invalid value makes the story an error.
- Error detection (built): Storybook RN's error boundary emits nothing on the channel, so the
  `withTargus` decorator wraps each story in its own boundary and emits `targus/storyError`. The
  CLI records the error instead of a snapshot, and the build fails (ADR 0004, rule 6).
- Capture hygiene (built): single-colour captures are flagged `blank`, and duplicate-hash groups
  are listed in the capture manifest (`duplicateHashes`), so web-only or broken stories are visible.
- Git metadata (built): `sha`, `branch` and PR number (from CircleCI or GitHub Actions env, or
  flags), `mergeBase` with the default branch, and the first-parent ancestor list of the merge
  base (at most 100), so the server can find the nearest ancestor that has a build. A shallow
  clone is refused, because it has no merge base to find.
- Content addressing (built): every PNG is named by its SHA-256. The API answers "which of
  these hashes has this project not uploaded", and the CLI uploads only those, plus its diff
  images (ADR 0014).

### 5.2 API (`apps/api`)

Hono on Workers. Every body and response is a zod contract from `@targus/core`. The route table
below is the built one; `apps/api/README.md` has the full table.

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/health` | none | Liveness and version |
| `POST /api/admin/projects` | admin token | Create a project (and its org when new); returns the project token once |
| `GET /api/projects/current` | project token | The token's project; `targus run` asks before capturing, so a bad token fails in seconds |
| `POST /api/builds` | project token | Create build, return baseline build + per-story baseline hashes + hashes this project has not uploaded |
| `PUT /api/images/:hash` | project token | Upload a PNG to R2 (idempotent) and record that this project uploaded it |
| `POST /api/builds/:id/results` | project token | Submit per-story results and diff stats; the server classifies, stores and creates the check run |
| `GET /api/builds/:id`, `/snapshots` | session or project token | Review data |
| `POST /api/snapshots/:id/review` | session | approve or deny; recomputes build status, updates check run |
| `POST /api/builds/:id/approve-all` | session | Bulk approve |
| `GET /api/images/:hash` | session or project token | Streams from R2 after an access check (ADRs 0011, 0014) |
| `GET /api/auth/github`, `/api/auth/github/callback`, `POST /api/auth/logout` | – | GitHub OAuth via the GitHub App (ADR 0011) |
| `GET /api/me`, `GET /api/projects`, `GET /api/projects/:id/builds` | session | Review data for the signed-in user |
| `GET /api/projects/:id/library` | session | Every story of the newest signed-off build on the default branch, with its accepted image |
| `POST /webhooks/github` | signature | **Not built** (v1.1): `installation.created` creates an org row. Today the org row is created with the first project. |

GitHub integration uses one GitHub App (ADR 0011):

- **Login** (built): the App's OAuth flow. The session is a signed HttpOnly cookie backed by a
  `sessions` row. A reviewer may read and review a project when GitHub says they are a member
  of the project's org, asked through the App installation and cached per user and org for one
  hour in `org_memberships`. An org row without an installation can be reviewed by nobody.
- **Check runs** (built): an installation access token is minted from the App's private key,
  which is stored as a Worker secret, and cached in memory per installation until shortly
  before it expires. The check run is named `targus/ios`. Its
  states: `in_progress` with "N changes awaiting review" while pending; `completed/success` when
  no change is pending or denied; `completed/failure` when any change is denied or a story
  errored. Without the App secrets the client is a no-op.

### 5.3 Web app (`apps/web`)

Built. Mirrors Chromatic's review UX, trimmed to what v1 stores:

- Projects and builds list: status chips (Pending review, Accepted, Denied, Passed, Failed,
  In progress), branch, PR link, commit, and counts of changed, new, removed and unstable
  snapshots.
- Build page: changes grouped by component title, filters for Unreviewed / Approved / Denied /
  New / Removed, "Verify changes" (primary; opens the first unreviewed change) and "Batch"
  (approve all, with confirmation).
- Snapshot page: Side-by-side, Diff overlay (pixelmatch output tinted), Slider, and
  Baseline/Current toggle; zoom; Approve and Deny; `j`/`k` to move between changes, `a` to
  approve, `d` to deny.
- Library page: every story of the newest signed-off build on the default branch, as a
  searchable grid grouped by component and one story at a time (`j`/`k`). It stands in for
  Chromatic's published Storybook, which an on-device Storybook cannot provide.
- The GitHub user's avatar and login are shown in the app rail.

### 5.4 Core (`packages/core`)

Built. Pure functions with fixture-based and property-based tests:

- `resolveBaseline(shaOrder, candidates)` picks the most recent successful build on the
  earliest sha that has one (`baselineShaOrder` puts the merge base first, then its ancestors).
  The API runs the same rule in SQL. Both are tested against `baselineResolutionCases`.
- `compareSnapshot(input)` yields
  `unchanged | changed | new | removed | unstable | error` and whether an existing approval
  carries forward.
- `diffImages(a, b, options)` wraps pixelmatch with an anti-aliasing tolerance, returning the
  changed-pixel ratio and the diff bitmap.
- `buildStatus(snapshots)`, and `tallySnapshots` with `buildStatusFromTally`, fold snapshot
  states into a build status and a check-run conclusion.
- `acceptedImageHash` (rule 5) and `libraryStories` (the library page).

## 6. Data model (D1)

The schema is `apps/api/src/db/schema.ts`, and its migrations are in `apps/api/migrations/`. The
main columns are listed here; the schema file is authoritative.

```
orgs             id, github_org (an org or a personal account), installation_id, created_at
projects         id, org_id, repo (owner/name), name, default_branch, token_hash, created_at
builds           id, project_id, number, sha, branch, pr_number, merge_base_sha,
                 baseline_build_id, trigger (pr|main), device, status, check_run_id,
                 review_version, per-state counts, created_at, completed_at
snapshots        id, build_id, story_id, variant, title, name, image_hash, width, height,
                 baseline_hash, diff_hash, diff_ratio, state
                 (unchanged|changed|new|removed|unstable|error), review (pending|approved|denied),
                 reviewed_by, reviewed_at, blank, error
approvals        id, project_id, story_id, variant, from_hash, to_hash, approved_by, approved_at
                 (unique per project, story, variant and hash pair; ADR 0013)
images           hash, size_bytes, width, height, created_at, last_referenced_at
project_images   project_id, hash, created_at        (who uploaded what; ADR 0014)
users            id, github_id, login, avatar_url, created_at, last_login_at
sessions         id_hash, user_id, created_at, expires_at   (SHA-256 of the session id; ADR 0015)
org_memberships  user_id, org_id, member, checked_at  (one-hour membership cache; ADR 0011)
```

Every project-owned table hangs off `org_id` through `projects`, and every query on one is
scoped by it (ADR 0007). That is what makes a second org a configuration change later. The
exceptions are deliberate:

- `images` is shared by every project so bytes are stored once, and access to it goes through
  `project_images` (ADR 0014).
- `users` and `sessions` belong to a GitHub user, not an org.
- `org_memberships` is a cache keyed by user and org.

Writes that change a build's state are single guarded D1 batches (ADR 0013).

### Baseline and approval rules

These are ADR 0004; core implements them, and the API applies them when results are submitted
and when a reviewer decides.

1. A PR build's baseline is the most recent successful build on its merge-base commit, else
   the nearest first-parent ancestor with one.
2. A snapshot is `unchanged` when hashes match or the diff ratio is at or under the threshold,
   `new` when the baseline lacks the story, `removed` when the baseline has a story the build
   lacks.
3. Approving a `changed` snapshot records `approvals(story, from_hash → to_hash)`. Later
   builds on any branch whose snapshot matches the same pair are auto-approved, so re-pushing a
   PR does not require re-review. Denying withdraws that approval.
4. A `main` build applies rule 3; anything still `changed` on main is `pending` and surfaces in
   the UI, since it reached main without review.
5. The accepted image for a story in a build is `image_hash` when approved or unchanged, else
   `baseline_hash`. That is what the next build compares against.
6. A story whose render errors is stored with state `error`, keeps its previous accepted image
   as baseline, and fails the build until a later build captures it.

**Not built:** baselines are not partitioned by device. A build stores its `device`, but
baseline lookup ignores it, so a device change shows up as changed stories rather than new ones
(section 7).

## 7. Determinism on device

Native rendering has more noise than react-native-web. Mitigations, cheapest first:

- Status bar (built): Storybook RN hides it when the on-device UI is off, so captures have none.
  The CLI still applies `simctl status_bar override` (9:41, full battery and signal) for
  projects that show it.
- Spinners (built as reporting): native `ActivityIndicator` cannot be frozen; such stories come
  out `unstable` (16 of 354 in the pilot app) and are reported, not blocking. Auto-masking the animated
  region is a v1.1 candidate.
- Device pinning (partly built): `targus run --device-name` is stored on the build.
  **Not built:** pinning the simulator device type and iOS runtime in a project config. The
  intent is that a device change makes every story `new`; today it does not (section 6).
- Reduced motion (**not built**): the `withTargus` decorator is to wrap stories in Reanimated's
  `ReducedMotionConfig`, and Lottie stories are to render with `autoPlay` off under targus.
- Date (**not built**): `MockDate` locked the same way the pilot app's web preview does.
- Network: stories must not depend on live network. the pilot app stories already use mock factories.
  This is the consumer's responsibility.
- Double-capture stability check (built, section 5.1): turns flaky stories into an explicit
  `unstable` state instead of noisy diffs.
- Diff threshold (partly built): anti-aliasing tolerant pixelmatch, changed above 0.1% of
  pixels. The server's `DIFF_THRESHOLD` decides the stored state, and `POST /api/builds` sends
  it to the CLI, which diffs with it; `targus run` has no threshold of its own (ADR 0028).
  **Not built:** tuning per project and per story.

## 8. the pilot app integration (CircleCI)

**Not built** (the the pilot app rollout, section 11). Planned job `visual_ios`, run on PRs and on `main`:

1. `checkout`, `js-dependencies`, `setup-env` (reuse existing commands).
2. `npx expo-updates fingerprint:generate --platform ios` → cache key
   `targus-ios-app-v1-{fingerprint}`. the pilot app already uses this fingerprint for OTA work.
3. `restore_cache`. On miss: `eas build --local --platform ios --profile storybook:simulator`
   (a new `eas.json` profile cloned from `staging:simulator`), extract the `.app`, `save_cache`.
4. `EXPO_PUBLIC_STORYBOOK_ENABLED=true EXPO_PUBLIC_TARGUS=true npx expo export:embed --platform ios --dev false --bundle-output … --assets-dest …`,
   then copy `main.jsbundle` and `assets/` into the cached `.app`.
5. Boot a simulator and run `npx targus run --udid … --app … --device-name "iPhone 16"`, with
   `TARGUS_TOKEN` and `TARGUS_API_URL` from a CircleCI context.

the pilot app-side changes:

- the `storybook:simulator` EAS profile;
- `.rnstorybook/index.tsx` passes `enableWebsockets`, `host: 'localhost'` and `port: 7007` when
  `EXPO_PUBLIC_TARGUS` is set;
- the `withTargus` decorator in `.rnstorybook/preview.tsx`.

Once the team trusts it, branch protection adds the `targus/ios` check. The CLI takes flags and
environment variables only. The `targus.config.ts` at the repo root that this plan once
listed is not built.

The `@targus/*` packages are not published yet (engineering-standards.md 6.5), so the pilot app would
consume them from a build of this repository until a release workflow exists.

Measured in the capture spike: the pilot app's native index has 354 stories. The capture loop takes about 7
minutes at a median of 1.0 s per story, and the rebundle step about 30 s. With boot, install and
upload, expect roughly 10 minutes per PR after the first cached native build. The native app is
rebuilt only when the fingerprint changes. The bundling step must use the same env as the
native build, or `app.config.ts` resolves differently and the bundle drifts.

## 9. Free-tier budget

| Service | Free allowance | targus usage estimate |
| --- | --- | --- |
| R2 | 10 GB storage, 1M class A, 10M class B ops/month | Baseline 354 images × ~200 KB ≈ 70 MB stored once; typical PR adds a few MB thanks to hashing. Over a hundred full baselines fit. |
| D1 | 5 GB, 5M row reads/day, 100k row writes/day; queries fail past the limit from Sept 2026 | ~200 writes per build, plus one `project_images` row per newly uploaded hash; plenty of headroom. Index every foreign key to keep row reads low. |
| Workers | 100k requests/day | API calls per build ≈ 200; review sessions fetch images through the Worker, which counts, so cap at a few thousand per day. Presigned R2 URLs are the escape hatch if this gets tight. |

Retention job (**not built**, v1.1): delete images not referenced by any build in the last 90
days. `images.last_referenced_at` exists for it. The job must delete the matching
`project_images` rows and keep any image a project still claims (ADR 0014). R2 deletes are free.

Sources: [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/), [D1 free tier limit enforcement changelog](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/), [D1 FAQ](https://developers.cloudflare.com/d1/reference/faq/), third-party summaries at [eastondev](https://eastondev.com/blog/en/posts/dev/20260526-cloudflare-free-limits/) and [HelpPuff](https://github.com/knowtific/helppuff/wiki/Cloudflare-Free-Plan). Numbers should be re-checked against the official pages.

## 10. Testing strategy

Summary only. What runs today, and the guards that run it, are in
[engineering-standards.md](engineering-standards.md#3-testing) section 3; what is planned is in
its section 6.

- `core`: unit tests with fixture images and fixture build graphs, plus `fast-check` property
  tests for the baseline and approval rules, which get the heaviest coverage.
- `cli`: `DeviceDriver` and `StorybookChannel` are ports; core's fakes exercise the capture loop
  without a simulator. A real-simulator test exists but runs only by hand. Running it in CI
  against `examples/basic` is not built.
- `api`: Vitest inside workerd with local D1 and R2; GitHub replaced by a recording stub. Covers
  auth, authorization across orgs, baseline resolution over HTTP, image upload records,
  check-run state transitions, retries and races.
- `web`: component and feature tests with Testing Library and MSW. Playwright drives the review
  flow against the local Worker (`e2e/review.spec.ts`), and `e2e/run.spec.ts` drives the built
  CLI.
- CI for targus itself runs on GitHub Actions' Linux runners. **Assumption failed:** the plan
  assumed a public repository, so that macOS runner minutes would be free for the simulator
  smoke test. The repository is private, so a simulator job needs paid macOS minutes, a
  self-hosted runner or CircleCI.

## 11. Milestones

**Capture spike. Done 2026-11-04, go.** Results and design changes in
[capture-spike.md](capture-spike.md): 354 stories captured at ~1.0 s median, bundle swap works
with and without `hermesc`, channel driving confirmed, error reporting needs the targus decorator.

**Walking skeleton with guards. Done 2026-11-04, except the GitHub-side guards.** Done:
`yarn check` and `yarn e2e` green, core domain rules with property tests, `targus capture` and
`targus compare` ported from the capture spike (354 the pilot app stories in 345 s), the `withTargus`
error-reporting decorator, and ADR 0010 on package builds. Not done: branch protection, a
changeset check, the capture e2e workflow, nightly jobs and a release workflow
(engineering-standards.md sections 6.2 to 6.8). The migration drift test landed with the service.

Original scope: the monorepo scaffold with every guard from
[engineering-standards.md](engineering-standards.md) live before any feature code: `yarn check`,
dependency-cruiser rules, coverage thresholds, branch protection, CODEOWNERS, AGENTS.md, PR
template, Changesets, one trivial test per package, and the e2e harness running an empty flow.
Then `packages/core` and `packages/cli` with `capture` and `compare` producing a local HTML
report. Already useful without a backend.

**Service. Built 2026-11-04, deployed 2026-11-05.** `apps/api` has:

- the admin, builds, images and results routes over D1 and R2, with project-token auth;
- server-side classification with `compareSnapshot` (ADR 0016);
- check runs through a GitHub App client (a no-op until the secrets exist);
- a migration drift test and full-flow tests (`apps/api/src/flows/`).

`targus run` opens a build, diffs against baselines locally, uploads images and submits
results; an e2e runs the built CLI against the local Worker. It is deployed to
<https://targus.targus-api.workers.dev> (D1 `targus`, R2 `targus-images`). The GitHub App
`targus-review` is registered with its secrets set; it still has to be installed on the
example-org org (the the pilot app rollout, below).

Since then: atomic results and review writes (ADR 0013), image access by upload record
(ADR 0014), and refusing shallow clones in `targus run`.

Original scope: `apps/api` with builds, images, baseline resolution, project tokens, D1
migrations, Wrangler deploy. `targus run` end to end with the check run created.

**Review app. Built 2026-11-04, deployed 2026-11-05.** Built:

- GitHub login through the App's OAuth flow, with signed cookie sessions and org-membership
  authorization (ADR 0011), extended to personal accounts (ADR 0012);
- in `apps/web`: the projects and builds lists, the build page with filters and approve-all,
  the snapshot viewer (side-by-side, diff, slider, toggle; `j`/`k`/`a`/`d`) and the library
  page;
- approve and deny record or withdraw carry-forward approvals and update the check run.

`e2e/review.spec.ts` drives the whole flow in Chromium against the local Worker, with a
stubbed GitHub (`e2e/support/github-stub.ts`). GitHub login is configured against the
`targus-review` App. Remaining: installing the App on example-org (the the pilot app rollout, below).

Original scope: GitHub login, build list, snapshot viewer, approve/deny, approve-all, check-run
updates.

**the pilot app rollout. Not started.** CircleCI job, EAS profile, decorators and config
(section 8). It needs published packages or another way for the pilot app to install the CLI, and the
App installed on example-org. Run it informational for a week, then make the check required.
Before the pilot app, the proof of concept on a personal-account repository (ADR 0012) exercises the
same path.

**v1.1 candidates.** GitHub Action wrapper and CircleCI orb, the `installation.created` webhook
for self-serve org onboarding, Android via `AdbDriver`, variants (font scale, dark mode), the
retention job, Slack summary, device-partitioned baselines, and review by repository permission for personal accounts (ADR 0012).

## 12. Open assumptions

- Name `targus` and package scope `@targus/*`.
- Simulator target iPhone 16 on the iOS runtime that ships with the Xcode on the pilot app's CircleCI
  image.
- Default diff threshold 0.1% changed pixels with anti-aliasing tolerance.
- Project tokens are created by a maintainer with the admin token through
  `POST /api/admin/projects` (`apps/api/README.md`), not via a UI and not by a CLI command. Only
  the token's hash is stored.
- Capture resolution is device pixels (3x). Images are stored as-is; the web app scales for
  display.
- Decided (ADR 0004, rule 6), no longer an assumption: a story that errors during render fails
  the build with the error text attached, rather than producing a snapshot.
