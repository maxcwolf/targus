# targus — visual review for React Native on-device Storybook

Status: draft v1 plan, 2026-11-04. Decisions below were agreed in conversation; items marked **Assumption** are my defaults and are open to change.

## 1. Goal

A Chromatic-equivalent for the *native* Storybook of a React Native app. On every pull request and every push to `main`, CI renders each story in an iOS simulator, screenshots it, compares it with the accepted baseline, and publishes the result as a GitHub check. Engineers sign in with GitHub, review each changed story side by side with its baseline, and approve or deny. The check stays pending until every change is approved, so the repo can require it before merge.

First consumer: `example-org/example-app`. Design for any repo in the example-org org now, and for other GitHub orgs later without a rewrite.

## 2. Agreed decisions

| Decision | Choice |
| --- | --- |
| Backend | Hosted service with a Chromatic-like review UI |
| Platforms (v1) | iOS only, one simulator, light mode, default font scale |
| Hosting | Cloudflare: Workers (API + static web app), R2 (images), D1 (metadata) |
| Tenancy | Org-scoped data model from day one; only example-org installed in v1 |
| App binary | Native simulator app cached by Expo fingerprint; JS rebundled per run |
| Gating | GitHub check run pending until all changes approved; passes when clean |
| CI runner (the pilot app) | CircleCI macOS, where the pilot app already builds and boots simulators |
| Capture | Full simulator screen via `simctl io screenshot`, status bar overridden |
| Triggers | PR builds and `main` builds; main auto-accepts PR approvals |
| Free tier | Applies to hosted services; CI minutes are the pilot app's existing CircleCI plan |

## 3. Non-goals for v1

- Android, dark mode, font-scale modes, iPad. The data model carries a `variant` key so these slot in later.
- TurboSnap-style "only changed stories". Every story is captured every run.
- Chromatic's per-branch baseline ancestry across arbitrary branches. v1 baselines come from the PR's merge-base with the default branch.
- Comments, Slack notifications, Figma links, interaction tests.
- A self-serve project-creation UI. Projects are created by an admin command.

## 4. How it works end to end

```
CircleCI macOS job (the pilot app)                          targus service (Cloudflare)
───────────────────────────────                      ───────────────────────────
1. fingerprint ─► restore cached .app
   (miss: eas build --local, save cache)
2. expo export:embed with Storybook on
   ─► swap main.jsbundle + assets into .app
3. targus run
   ├─ boot simulator, override status bar
   ├─ install + launch app (Storybook UI)
   ├─ host the Storybook channel on ws://localhost:7007
   ├─ ask app for story index
   ├─ for each story: select ─► wait rendered ─► settle ─► screenshot ─► hash
   ├─ POST /builds (git metadata + snapshot list) ───► resolve baseline build
   │                                               ◄── baseline hashes + missing hashes
   ├─ download baselines that differ, diff locally (pixelmatch)
   ├─ PUT missing images + diff images to R2 (via API)
   └─ POST results ────────────────────────────────► store, create GitHub check run
                                                      (pending: "7 changes to review")

Engineer opens check link ─► web app (GitHub login) ─► approve / deny
                                                      ─► check run updated (success / failure)
Merge to main ─► main build ─► changes with a matching PR approval auto-accept
                              ─► main build becomes the next baseline
```

### Why diffing happens on the CI runner, not the server

Workers on the free plan have a small per-request CPU budget. Decoding two 3x retina PNGs and running pixelmatch would exceed it. The CI runner is a macOS machine with idle cores, so the CLI downloads only the baselines whose hash differs (usually a handful), diffs there, and uploads results plus diff images. The server stays a thin metadata and storage layer. Trade-off: results are trusted from an authenticated CLI, which is acceptable for an internal tool, and a build cannot be re-diffed with a different threshold without re-running.

## 5. Components

Monorepo, TypeScript end to end, Yarn 4 workspaces (the same toolchain the pilot app uses).

```
targus/
  packages/core        Pure logic, no I/O. Types, zod schemas, diff, baseline resolution,
                       approval carry-forward, story-id normalisation. 100% unit-testable.
  packages/cli         `targus` binary. Device driver (simctl), Storybook channel server,
                       capture loop, git metadata, API client, local HTML report.
  packages/react-native  App-side helper: `withTargus` decorator (error boundary that reports
                       render errors over the channel, reduced motion, locked date, settle
                       hints) and `parameters.targus` typings. Required for error detection.
  apps/api             Cloudflare Worker: Hono router, Drizzle + D1, R2 bindings, GitHub App
                       auth, check runs. Also serves the built web app as static assets.
  apps/web             React + Vite review UI (TanStack Router + Query). Built into apps/api.
  examples/basic       Minimal Expo app with a few stories, used by targus's own e2e test.
  docs/
```

Tooling: strict TypeScript, Vitest, ESLint + Prettier, Changesets for versioning, Wrangler for deploys, `@cloudflare/vitest-pool-workers` for API tests against local D1 and R2. Architecture rules, code standards, the test pyramid and the guards that enforce them are in [engineering-standards.md](engineering-standards.md).

### 5.1 CLI (`packages/cli`)

Commands:

- `targus capture --app <path.app> --device "iPhone 16" --out <dir>` captures every story to a directory with a `manifest.json`. Works offline. Useful on its own.
- `targus compare --current <dir> --baseline <dir>` produces a local HTML report. This replaces the March 2026 `.visual-screenshots` experiment.
- `targus run` does capture, resolve baseline, diff, upload, and publish in one go. This is what CI calls.

Internals:

- `DeviceDriver` interface: `boot`, `install`, `launch(env)`, `setStatusBar`, `screenshot`, `shutdown`. One implementation, `SimctlDriver`, in v1. An `AdbDriver` lands with Android.
- `ChannelServer`: a WebSocket server speaking Storybook's channel protocol. Storybook RN 10's app connects to it when `enableWebsockets` is on. The CLI emits `setCurrentStory` and waits for `storyRendered` or `storyUnchanged`; it asks for the index with `RN_GET_INDEX`. Proven in the M0 spike ([spike-m0.md](spike-m0.md)); the deep-link fallback is no longer planned. `storyRendered` fires on React commit, not on paint, so the settle delay below is load-bearing.
- Settle logic: after `storyRendered`, wait `parameters.targus.delay` (default 300 ms), screenshot, then screenshot again after 150 ms and compare. If the two differ, retry with a doubled settle up to 3 times and mark the story `unstable` rather than silently diffing noise. `unstable` never blocks the check; `parameters.targus.skip` opts a story out.
- Error detection: Storybook RN's error boundary emits nothing on the channel, so the `withTargus` decorator wraps each story in its own boundary and emits `targus/storyError`. The CLI records the error instead of a snapshot and fails the build.
- Capture hygiene: single-colour captures are flagged `blank`, and duplicate-hash groups are listed in the summary so web-only or broken stories are visible.
- Git metadata: `sha`, `branch`, PR number (from CI env), `mergeBase` with the default branch, and the first-parent ancestor list of the merge base (`git rev-list --first-parent -n 100`) so the server can find the nearest ancestor that has a build.
- Content addressing: every PNG is named by SHA-256. The API answers "which of these hashes do I not have" and the CLI uploads only those.

### 5.2 API (`apps/api`)

Hono on Workers. Routes (all JSON, zod-validated at the edge):

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /api/builds` | project token | Create build, return baseline build + per-story baseline hashes + missing image hashes |
| `PUT /api/images/:hash` | project token | Upload a PNG to R2 (idempotent) |
| `POST /api/builds/:id/results` | project token | Submit per-story statuses and diff stats; creates the check run |
| `GET /api/builds/:id`, `/snapshots` | session | Review data |
| `POST /api/snapshots/:id/review` | session | approve or deny; recomputes build status, updates check run |
| `POST /api/builds/:id/approve-all` | session | Bulk approve |
| `GET /api/images/:hash` | session | Streams from R2 after an auth check |
| `GET /api/auth/github`, `/api/auth/github/callback`, `POST /api/auth/logout` | – | GitHub OAuth via the GitHub App (ADR 0011) |
| `GET /api/me`, `GET /api/projects`, `GET /api/projects/:id/builds` | session | Review data for the signed-in user |
| `POST /webhooks/github` | signature | `installation.created` creates an org row (v1.1; v1 seeds manually) |

GitHub integration uses one GitHub App ("targus"):

- **Login**: the App's OAuth flow. Session is a signed HttpOnly cookie. On login the API checks the user is a member of the project's org and caches that in the session for an hour.
- **Check runs**: installation access token minted per request from the App's private key (stored as a Worker secret). Check run states: `in_progress` with "N changes awaiting review" while pending; `completed/success` when no pending or denied changes; `completed/failure` when any change is denied.

### 5.3 Web app (`apps/web`)

Mirror Chromatic's review UX, trimmed to what v1 stores:

- Project page: builds list with status chips (Pending review, Accepted, Denied, Passed, Failed capture), branch, PR link, commit, counts of changed/new/removed/unstable.
- Build page: changes grouped by component title, filters for Unreviewed / Approved / Denied / New / Removed, "Approve all" with confirmation.
- Snapshot page: tabs for Side-by-side, Diff overlay (pixelmatch output tinted), Slider, and Baseline/Current toggle; zoom; Approve and Deny buttons; `j`/`k` to move between changes, `a` to approve.
- Header shows the GitHub user and org.

### 5.4 Core (`packages/core`)

Pure functions with fixture-based tests:

- `resolveBaseline(build, candidateBuilds)` picks the nearest ancestor build that completed successfully.
- `compareSnapshot(current, baseline, approvals)` yields `unchanged | changed | new | removed | unstable` and whether an existing approval carries forward.
- `diffImages(a, b, options)` wraps pixelmatch with an anti-aliasing tolerance and a configurable threshold, returning changed-pixel ratio and the diff bitmap.
- `buildStatus(snapshots)` folds snapshot states into a build state and a check-run conclusion.

## 6. Data model (D1)

```
orgs           id, github_org, installation_id, created_at
projects       id, org_id, repo (owner/name), name, default_branch, token_hash, created_at
builds         id, project_id, number, sha, branch, pr_number, merge_base_sha,
               baseline_build_id, trigger (pr|main), device, status, created_at, completed_at
snapshots      id, build_id, story_id, variant, image_hash, width, height,
               baseline_hash, diff_hash, diff_ratio, state
               (unchanged|changed|new|removed|unstable), review (pending|approved|denied),
               reviewed_by, reviewed_at
approvals      project_id, story_id, variant, from_hash, to_hash, approved_by, at
users          github_id, login, avatar_url
sessions       id, user_id, expires_at
images         hash, bytes, width, height, created_at, last_referenced_at
```

Every table hangs off `org_id` through `projects`, and every query is scoped by it. That is what makes a second org a configuration change later.

### Baseline and approval rules

1. A PR build's baseline is the most recent successful build on its merge-base commit, else the nearest first-parent ancestor with one.
2. A snapshot is `unchanged` when hashes match or the diff ratio is under the threshold, `new` when the baseline lacks the story, `removed` when the baseline has a story the build lacks.
3. Approving a `changed` snapshot records `approvals(story, from_hash → to_hash)`. Later builds on any branch whose snapshot matches the same pair are auto-approved, so re-pushing a PR does not require re-review.
4. A `main` build applies rule 3; anything still `changed` on main is `pending` and surfaces in the UI, since it reached main without review.
5. The accepted image for a story in a build is `image_hash` when approved or unchanged, else `baseline_hash`. That is what the next build compares against.

## 7. Determinism on device

Native rendering has more noise than react-native-web. Mitigations, cheapest first:

- Status bar: Storybook RN hides it when the on-device UI is off, so captures have none. `simctl status_bar override` is still applied for projects that show it.
- Spinners: native `ActivityIndicator` cannot be frozen; such stories come out `unstable` (16 of 354 in the pilot app) and are reported, not blocking. Auto-masking the animated region is a v1.1 candidate.
- Pin the simulator device type and iOS runtime in the project config; store them on the build. A device change makes every story `new`, by design.
- Reduced motion: the `withTargus` decorator wraps stories in Reanimated's `ReducedMotionConfig` (always) and sets `parameters.targus.delay` where a story needs it. Lottie stories render with `autoPlay` off under targus.
- Date: `MockDate` locked the same way the pilot app's web preview does.
- Network: stories must not depend on live network. the pilot app stories already use mock factories.
- Double-capture stability check (section 5.1) turns flaky stories into an explicit `unstable` state instead of noisy diffs.
- Diff threshold default: anti-aliasing tolerant pixelmatch, fail above 0.1% changed pixels. Tunable per project and per story.

## 8. the pilot app integration (CircleCI)

New job `visual_ios`, runs on PRs and on `main`:

1. `checkout`, `js-dependencies`, `setup-env` (reuse existing commands).
2. `npx expo-updates fingerprint:generate --platform ios` → cache key `targus-ios-app-v1-{fingerprint}`. the pilot app already uses this fingerprint for OTA work.
3. `restore_cache`. On miss: `eas build --local --platform ios --profile storybook:simulator` (new `eas.json` profile cloned from `staging:simulator`), extract the `.app`, `save_cache`.
4. `EXPO_PUBLIC_STORYBOOK_ENABLED=true EXPO_PUBLIC_TARGUS=true npx expo export:embed --platform ios --dev false --bundle-output … --assets-dest …`, then copy `main.jsbundle` and `assets/` into the cached `.app`.
5. `npx targus run --app … --device "iPhone 16"` with `TARGUS_TOKEN` from a CircleCI context.

the pilot app-side changes: the `storybook:simulator` EAS profile; `.rnstorybook/index.tsx` passes `enableWebsockets`, `host: 'localhost'`, `port: 7007` when `EXPO_PUBLIC_TARGUS` is set; the `withTargus` decorator in `.rnstorybook/preview.tsx`; a `targus.config.ts` at the repo root. Branch protection adds the `targus/ios` check once the team trusts it.

Measured in the M0 spike: the pilot app's native index has 354 stories; the capture loop takes about 7 minutes at a median of 1.0 s per story, and the rebundle step about 30 s. With boot, install and upload, expect roughly 10 minutes per PR after the first cached native build. Native rebuilds only when the fingerprint changes. The bundling step must use the same env as the native build, or `app.config.ts` resolves differently and the bundle drifts.

## 9. Free-tier budget

| Service | Free allowance | targus usage estimate |
| --- | --- | --- |
| R2 | 10 GB storage, 1M class A, 10M class B ops/month | Baseline 354 images × ~200 KB ≈ 70 MB stored once; typical PR adds a few MB thanks to hashing. Over a hundred full baselines fit. |
| D1 | 5 GB, 5M row reads/day, 100k row writes/day; queries fail past the limit from Sept 2026 | ~200 writes per build; plenty of headroom. Index every foreign key to keep row reads low. |
| Workers | 100k requests/day | API calls per build ≈ 200; review sessions fetch images through the Worker, which counts, so cap at a few thousand per day. Presigned R2 URLs are the escape hatch if this gets tight. |

Retention job (v1.1): delete images not referenced by any build in the last 90 days. R2 deletes are free.

Sources: [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/), [D1 free tier limit enforcement changelog](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/), [D1 FAQ](https://developers.cloudflare.com/d1/reference/faq/), third-party summaries at [eastondev](https://eastondev.com/blog/en/posts/dev/20260526-cloudflare-free-limits/) and [HelpPuff](https://github.com/knowtific/helppuff/wiki/Cloudflare-Free-Plan). Numbers should be re-checked against the official pages when the Cloudflare account is set up.

## 10. Testing strategy

Summary only; the full pyramid, thresholds and hygiene rules are in [engineering-standards.md](engineering-standards.md#3-testing).

- `core`: unit tests with fixture images and fixture build graphs. This is where the baseline and approval rules live, so they get the heaviest coverage.
- `cli`: `DeviceDriver` and `ChannelServer` are interfaces; a `FakeDriver` and a fake app client exercise the capture loop without a simulator. One real-simulator smoke test runs in targus's own CI against `examples/basic`.
- `api`: vitest-pool-workers with local D1 and R2; GitHub API mocked with MSW. Covers auth, authorization, baseline resolution over HTTP, check-run state transitions.
- `web`: component tests for the snapshot viewer and review flow; one Playwright happy path against the local Worker.
- CI for targus itself on GitHub Actions. **Assumption**: the targus repo is public (MIT) so macOS runner minutes are free for the simulator smoke test. If it must be private, the smoke test moves to CircleCI or runs on demand.

## 11. Milestones

**M0 — Spike. Done 2026-11-04, go.** Results and design changes in [spike-m0.md](spike-m0.md): 354 stories captured at ~1.0 s median, bundle swap works with and without `hermesc`, channel driving confirmed, error reporting needs the targus decorator.

**M1 — Walking skeleton with guards. Done 2026-11-04.** `yarn check` and `yarn e2e` green; core domain rules with property tests; `targus capture` and `targus compare` ported from the spike (354 the pilot app stories in 345 s); `withTargus` error-reporting decorator; ADR 0010 on package builds. Not yet: GitHub-side settings (branch protection, Changesets bot), capture e2e workflow, nightly jobs, release workflow, migration drift test.

Original scope: The monorepo scaffold with every guard from
[engineering-standards.md](engineering-standards.md) live before any feature code: `yarn check`,
dependency-cruiser rules, coverage thresholds, branch protection, CODEOWNERS, AGENTS.md, PR
template, Changesets, one trivial test per package, and the e2e harness running an empty flow.
Then `packages/core` and `packages/cli` with `capture` and `compare` producing a local HTML
report. Already useful without a backend.

**M2 — Service. Built 2026-11-04, deployed 2026-11-05.** `apps/api` has the admin, builds, images and results routes over D1 and R2, project-token auth, server-side classification with `compareSnapshot`, check runs through a GitHub App client (no-op until the secrets exist), a migration drift test and a full-flow test. `targus run` opens a build, diffs against baselines locally, uploads images and submits results; an e2e runs the built CLI against the local Worker. Deployed to <https://targus.targus-api.workers.dev> (D1 `targus`, R2 `targus-images`, `ADMIN_TOKEN` and `SESSION_SECRET` set). The GitHub App `targus-review` is registered with its secrets set; it still has to be installed on the example-org org (M4).

Original scope: `apps/api` with builds, images, baseline resolution, project tokens, D1 migrations, Wrangler deploy. `targus run` end to end with the check run created.

**M3 — Review app. Built 2026-11-04, deployed 2026-11-05.** GitHub login through the App's OAuth flow with signed cookie sessions and org-membership authorization (ADR 0011); `apps/web` has the projects and builds lists, the build page with filters and approve-all, and the snapshot viewer (side-by-side, diff, slider, toggle; `j`/`k`/`a`/`d`); approve and deny withdraw or record carry-forward approvals and update the check run. `e2e/review.spec.ts` drives the whole flow in Chromium against the local Worker with a stubbed GitHub (`e2e/support/github-stub.ts`). GitHub login is configured against the `targus-review` App; `GET /api/auth/github` redirects to GitHub. Remaining: installing the App on example-org and a first real sign-in (M4).

Original scope: GitHub login, build list, snapshot viewer, approve/deny, approve-all, check-run updates.

**M4 — the pilot app rollout.** CircleCI job, EAS profile, decorators, config. Run informational for a week, then make the check required.

**v1.1 candidates.** GitHub Action wrapper and CircleCI orb, `installation.created` webhook for self-serve org onboarding, Android via `AdbDriver`, variants (font scale, dark mode), retention job, Slack summary.

## 12. Open assumptions

- Name `targus` and package scope `@targus/*`.
- Simulator target iPhone 16 on the iOS runtime that ships with the Xcode on the pilot app's CircleCI image.
- Default diff threshold 0.1% changed pixels with anti-aliasing tolerance.
- Project tokens are created by a `targus admin create-project` command run by a maintainer, not via UI.
- Capture resolution is device pixels (3x). Images are stored as-is; the web app scales for display.
- A story that errors during render fails the build with the error text attached, rather than producing a snapshot.
