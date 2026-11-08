# targus for web: plan

Status: proposed, 2026-11-08. Nothing here is built yet. The decision records that go with it
are [ADR 0036](adr/0036-builds-belong-to-a-platform.md) (proposed) and the web capture ADR
the spike will produce (section 6, step W0).

## 1. Goal

The same review loop targus runs for iOS, run on a project's **web Storybook**: CI renders every
story in a browser, screenshots it, compares it with the accepted baseline, and holds a GitHub
check (`targus/web`) until each change is approved. Approve, deny, approve-all, carry-forward
approvals, the library and the check run behave exactly as they do for iOS.

Longer term, targus aims to match Chromatic's feature set for web while staying "Chromatic for
native" (section 8). Accessibility testing and assistive-technology (screen reader) testing on
both platforms are wanted later (section 9). For now targus stays a visual diff service.

## 2. Why this is mostly done already

Most of targus does not know which platform a picture came from:

| Part | Platform-specific today? |
| --- | --- |
| API: builds, baselines from the merge base, results, approvals, review, check runs | No, except the baseline lookup and the check-run name (section 4) |
| Core: `compareSnapshot`, baseline resolution, approval carry-forward, build status | No |
| Review UI: builds, snapshot viewer, library | Mostly no; it assumes 3x captures when showing actual size |
| Storage: content-addressed images in R2 | No |
| CLI: git metadata, API client, run flow, diffing (ADRs 0003, 0016, 0028) | No |
| CLI: capture loop (`captureStories`: select, settle, double screenshot, retries) | No, it uses only `getIndex`, `selectStory` and `screenshot` |
| CLI: simulator setup (`SimctlDriver`), websocket channel, `withTargus` decorator | Yes, iOS only |

What web needs is a second capture front end, a platform on each build, and a diff that copes
with images of different sizes.

## 3. Consumers

- **wolf-ui** (`maxcwolf/wolf-ui`): a React Native component library with one set of stories
  built two ways, an on-device Storybook (`.rnstorybook`) and a web Storybook through
  `@storybook/react-native-web-vite` (`.storybook`). Its `e2e/visual.spec.ts` already takes
  Playwright screenshots of `#storybook-root` per story in light and dark, in the official
  Playwright Docker image. It is the web proof of concept, playing the role the demo repository
  plays for iOS. Its existing screenshots give a known-good comparison for the first captures,
  and targus replacing that suite is the first success criterion.
- **The pilot app**: the same shape (on-device and react-native-web Storybooks from the same
  stories, about 120 story files). Its web Storybook is checked by Chromatic today, in a GitHub
  Actions job on `ubuntu-latest`. Its stories use these Chromatic parameters, which set the
  parity bar for the pilot:
  - `chromatic.disable` and `chromatic.disableSnapshot`;
  - `chromatic.delay`;
  - `chromatic.modes` keyed by mode name, each setting globals (a font-scale global) or a
    `viewport` (`{ width, height }`).

  Its job also uses `onlyChanged` (TurboSnap), `exitZeroOnChanges` and `exitOnceUploaded`. Only
  the first matters for parity, and it is a speed feature, not a correctness one (section 8).

The pilot app is the first real application for both platforms. Web may reach it first: it
needs no simulator build, and it replaces a paid service the pilot team already runs.

## 4. Builds belong to a platform (ADR 0036)

An iOS run and a web run of the same commit are two builds of one project. Today nothing tells
them apart, so a web build could take an iOS build as its baseline and both would write the same
`targus/ios` check run. The fix, in core, API and UI:

- `Platform = 'ios' | 'android' | 'web'` in core. `CreateBuildRequest.platform` defaults to
  `ios`, so CLIs that predate it keep working (the same pattern as `appearance`, ADR 0035).
- `builds.platform` (not null, default `ios`) in a new migration; existing rows become `ios`.
- Baseline resolution filters by platform: `resolveBaseline` in core, and both SQL forms in
  `build.repository.ts` (`findLatestSuccessfulForShas`, `findLatestBaselineOnBranch`).
- The idempotency check treats a different platform as a different build (ADR 0027).
- The check run is named `targus/<platform>`. iOS keeps `targus/ios`, so branch protection that
  already requires it is unaffected.
- The library is per platform (`GET /api/projects/:id/library?platform=`), with a platform
  switch in the UI. The builds list and build header show the platform.
- `builds.pixel_ratio`: the UI's actual-size view divides by it instead of assuming 3x.
  `ios` builds are 3; web builds record what the CLI captured at.
- Approvals need no change: carry-forward is keyed by story, variant and hash pair, and hashes
  never collide across platforms.

This ships on its own before any web capture, and it changes nothing for iOS.

## 5. Web capture in the CLI

### 5.1 Shape

```
targus run --platform web --storybook-dir storybook-static [--viewport 1200x900]
  ├─ serve storybook-static on 127.0.0.1:<free port> (node:http, no dependency)
  ├─ launch Chromium (playwright-core)
  ├─ read /index.json ─► stories (type "story" only)
  ├─ for each story: open iframe.html?id=<id>&viewMode=story
  │    ─► wait for storyRendered, or an error event ─► read parameters
  │    ─► wait for fonts and images ─► settle ─► screenshot #storybook-root twice ─► hash
  └─ same as iOS from here: POST /api/builds, diff locally, upload, POST results
```

`--storybook-url` points at an already running or deployed Storybook instead of a directory.
`targus capture --platform web` writes a capture directory the same way, for local use and
`--from-capture`.

### 5.2 Ports and packages

- The capture loop needs only `getIndex`, `selectStory` and `screenshot`. Narrow its input to
  those (a `StorybookChannel` plus a `screenshot()`), and keep device setup (boot, install,
  launch, status bar, appearance) in each platform's command. Native keeps `SimctlDriver` and
  `WsStorybookChannel` unchanged behind it.
- One web adapter in `packages/cli/src/adapters/` implements both halves on a Playwright page.
  A page `crash` or `close` stops the capture the way a dead app does (ADR 0021).
- `playwright-core` is an **optional peer dependency** of `@targus/cli`, loaded with a dynamic
  import only for `--platform web`, with an error naming the package when it is missing. iOS
  users never install it. Browsers come from the official Playwright Docker image, or from
  `npx playwright install chromium`. The CLI records the browser name and version as the build's
  `device`.
- No app-side package for web. The web preview already exposes what the native decorator
  reports: render events on its channel (`storyRendered`, `storyErrored`, `storyThrewException`,
  `playFunctionThrewException`, `storyMissing`) and each story's parameters through the preview's
  story store. The spike confirms both on Storybook 10 (step W0).

### 5.3 Story parameters

`parameters.targus` (`skip`, `delay`) works as on iOS. When a story has no `parameters.targus`,
the web capture reads `parameters.chromatic` as a fallback: `disable` and `disableSnapshot` mean
skip, `delay` means delay, and `modes` means modes (step W5). The pilot app's stories then work
without edits. The native decorator keeps reading only `parameters.targus` until the pilot asks
otherwise.

### 5.4 Determinism

Browsers are far less noisy than simulators, but they are only deterministic within one browser
build, one set of fonts and one OS:

- Run in the official Playwright image whose tag matches the CLI's `playwright-core`
  (`container:` in GitHub Actions). The guide says so, and the CLI warns when the browser
  version differs from the one it was built against.
- Defaults: reduced motion emulated, CSS animations and transitions disabled at screenshot time,
  caret hidden, `document.fonts.ready` and every `<img>` loaded before the settle, locale
  `en-US`, timezone `UTC`. Each default can be overridden by a flag.
- The double-screenshot stability check and `unstable` state carry over unchanged
  (ADR 0030).
- Locking the date stays the consumer's job, as the pilot app's preview already does.

### 5.5 What a capture is

The bounding box of `#storybook-root`, as Chromatic and wolf-ui's own suite do, at a default
viewport of 1200x900 (to be checked against Chromatic's default) and pixel ratio 1. A story whose
root has no size, or whose `layout` is `fullscreen`, is captured as the viewport. One page per
story and sequential capture to start with; parallel pages later if run time needs it (at an
estimated 0.3 to 0.5 s a story, the pilot app's web Storybook takes a few minutes).

### 5.6 Diffing images of different sizes

`diffImages` reports any size change as 100% changed with no diff image. That is acceptable for
full-screen phone captures, but a cropped component changes size whenever its content does
("the button got 4 px wider"). `diffImages` will pad both images onto the larger canvas,
anchored top left, diff them, and return a diff image, with the ratio over the larger area. The
server and the review rules do not change.

## 6. Steps

Each step is one PR or a few, with `yarn check` green, and leaves iOS working.

| Step | What | Done when |
| --- | --- | --- |
| W0 | **Spike**, throwaway script outside `packages/`: Playwright against wolf-ui's and the pilot app's `storybook-static`. Confirm the render and error events, reading parameters from the preview, the root crop on react-native-web, timing per story, and two runs in the Docker image being byte-identical. | `docs/web-capture-spike.md` with numbers and a go or no-go; the web capture ADR written |
| W1 | **Platform on builds** (section 4): core, migration, baseline filters, check-run name, library and UI, pixel ratio. | iOS demo runs unchanged; a hand-made `web` build gets its own baseline and `targus/web` check |
| W2 | **Padded diff** (section 5.6) in core, with property tests. | A wider capture diffs with an overlay |
| W3 | **Web capture** (section 5): port narrowing, Playwright adapter, static server, `--platform web` on `capture` and `run`, parameters with the Chromatic fallback, determinism defaults. Tested against a scripted fixture page in the style of `ws-channel.scripted-app.ts`, plus one e2e on a tiny built Storybook. | `targus run --platform web` opens a build against the local Worker in e2e |
| W4 | **Dogfood on wolf-ui**: a GitHub Actions job in the Playwright image; a PR with a deliberate change reviewed live. | `targus/web` goes pending, then green on approval; captures match wolf-ui's own screenshots |
| W5 | **Modes**: `parameters.targus.modes` (and `chromatic.modes`), named sets of globals and an optional viewport. Each mode is a snapshot `variant` named after the mode (a story without modes has `default`). Globals go through the iframe URL. | wolf-ui's light and dark, and the pilot app's font-scale and viewport modes, each capture as their own variant |
| W6 | **Pilot web rollout**: a job beside the existing Chromatic job, informational for a week, then `targus/web` becomes the required check and the Chromatic job is removed. | The pilot team reviews web changes in targus only |

Prerequisites shared with the iOS pilot rollout (plan.md section 11): `@targus/cli` published so
the pilot app can install it, and the GitHub App installed on the pilot team's org.

## 7. Decisions to confirm

- **One project, builds per platform** (ADR 0036), rather than one project per platform. One
  project gives a single library with a platform switch, and later a side-by-side view of the
  same story on iOS and web. Separate projects would need only the check-run name change, but
  split the library and the review queue in two.
- **Capture on the CI runner with Playwright**, rather than a hosted rendering farm. It keeps
  ADR 0003's split and the free tier, at the cost of the consumer's CI minutes and the need to
  pin the Docker image.
- **Honour `parameters.chromatic`** as a fallback on web, so moving off Chromatic needs no story
  edits.
- **Pixel ratio 1 by default** on web. Smaller images and the same as most web review tools;
  `--pixel-ratio 2` for teams that want sharper review images.

## 8. Toward Chromatic parity

Not needed for the pilot's switch, ordered by value:

| Chromatic feature | targus |
| --- | --- |
| Capture, diff, review, approve, PR check | iOS built; web steps W0 to W4 |
| Modes (viewports × globals) | W5 on web; on iOS appearance is per build today (ADR 0035), font scale needs the decorator |
| `disable`, `disableSnapshot`, `delay` | W3 |
| Per-story `diffThreshold` | Needs a server-side setting: the server owns the threshold (ADR 0028) |
| Ignore regions (`data-chromatic="ignore"`), `pauseAnimationAtEnd` | After W5; ignore regions masked before hashing |
| Play functions and interaction tests | Storybook should emit `storyRendered` only after the play function finishes, so its end state is captured (the spike confirms); a failing play function is a story error in W3. Reporting interaction results separately comes later |
| TurboSnap (`onlyChanged`) | Later: `preview-stats.json` plus the git diff picks the stories; unchanged stories carry their baseline hash forward |
| Firefox, Safari (WebKit), Edge | Later: a browser per variant or per build; Playwright already ships Firefox and WebKit |
| Published Storybook per build, links from the review | Later: `storybook-static` to R2, served from a public bucket domain, not through the Worker (its request limit) |
| UI Review (comments, PR-level review) | Later |
| GitLab, Bitbucket, self-serve projects, Slack | Later; GitHub only today, projects created by admin call |
| Accessibility tests | Section 9 |

## 9. Later: accessibility and assistive-technology testing

Out of scope until the visual service runs on both platforms for the pilot, but kept possible:

- **Accessibility checks.** On web, axe-core runs in the page the capture already loaded, so it
  costs little extra time. On iOS, the accessibility tree is read from the app through the
  decorator or from the simulator. Results are stored per story and per platform, are reviewable
  like visual changes (new violations wait for review, known ones carry forward), and get their
  own check run.
- **Screen reader testing.** Transcripts of what a screen reader announces while moving through a
  story, stored as text snapshots and reviewed as text diffs. On web a virtual screen reader is
  enough for CI; real VoiceOver runs on macOS. wolf-ui already does both with Guidepup, which
  makes it the natural first consumer again.
- Nothing in steps W0 to W6 should assume that a build holds only images. The `variant` key and
  the per-platform build leave room for an `a11y` or `screen-reader` kind beside `visual`.
