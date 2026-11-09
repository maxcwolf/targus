# 0037. Web capture with Playwright on the runner

## Status

accepted

## Date

2026-11-08

## Context

targus is to review web Storybooks as well as on-device ones ([web-plan.md](../web-plan.md)).
Each build already belongs to a platform (ADR 0036). Something has to render each story in a
browser and screenshot it, and the rest of the run (open a build, diff locally, upload, submit
results, ADRs 0003 and 0016) should stay as it is.

The spike ([web-capture-spike.md](../web-capture-spike.md)) showed that, in the official
Playwright Docker image, a built Storybook renders every story of three real Storybooks, that the
preview reports when a story rendered or failed and what its parameters are, and that two runs
produce byte-identical images apart from animated stories.

## Decision

We will capture web stories in the CLI, on the CI runner, with `playwright-core` and Chromium.

- `targus capture` and `targus run` take `--platform web` with `--storybook <dir or url>`. A
  directory is served on `127.0.0.1` by a small `node:http` server in the CLI.
- One adapter implements the existing `StorybookChannel` port on a Playwright page: the index
  comes from `index.json`, `selectStory` opens `iframe.html?id=…&viewMode=story` and waits for the
  preview's render or error events, then for fonts and images, and reads the story's parameters
  from the preview's story store. The same object takes the screenshot. The capture loop
  (`captureStories`: settle, double screenshot, retries, skip and delay) is shared with iOS; it
  needs only `getIndex`, `selectStory` and `screenshot`.
- A capture is the bounding box of `#storybook-root` at a 1200x900 viewport and pixel ratio 1,
  both flags. A root with no size falls back to the viewport.
- Determinism defaults: reduced motion, animations disabled and the caret hidden at screenshot
  time, locale `en-US`, timezone `UTC`.
- `parameters.targus` decides skip and delay. Without it, `parameters.chromatic` is read:
  `disable` or `disableSnapshot` skip the story, and `delay` sets the delay.
- `playwright-core` is an optional peer dependency of `@targus/cli`, imported only for web. The
  supported runtime is the official Playwright image whose version matches it; the CLI records the
  browser name and version as the build's device, so a browser change shows up on the build.
- No app-side package is needed for web.

## Consequences

### Positive

- Web reuses the whole run and review flow; only the front end of the capture is new.
- iOS users never install Playwright.
- Stories written for Chromatic run unchanged.

### Negative

- Consumers must run web captures in the pinned image, or accept that fonts and anti-aliasing
  from another OS change every story once.
- The CLI depends on Storybook's preview globals (`__STORYBOOK_ADDONS_CHANNEL__`,
  `__STORYBOOK_PREVIEW__`), which are not a public API. A Storybook upgrade can break them; the
  adapter fails with a message that names what it could not find.
- Capture runs on the consumer's CI minutes, one story at a time for now.

## Alternatives considered

- **A hosted rendering farm**, as Chromatic does. Not chosen: it breaks the free tier and the
  diff-on-runner split (ADR 0003).
- **Storybook's test runner.** It runs Jest around Playwright; a library call fits the CLI better
  and avoids another runner in the consumer's CI.
- **`@playwright/test` as the capture engine.** It is a test framework with its own runner and
  reporters; `playwright-core` is the library underneath it.
