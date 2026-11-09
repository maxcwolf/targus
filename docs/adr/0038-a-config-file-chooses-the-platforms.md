# 0038. A config file chooses the platforms a run captures

## Status

accepted

## Date

2026-11-08

## Context

With web capture (ADR 0037) a project can be captured on iOS, on web, or on both, and each
platform is its own build (ADR 0036). Until now every setting came from flags and the
environment; ADR 0006's amendment notes that there is no project config file. A project that
captures both platforms would need two long command lines, and nothing in the repository would
say which platforms the project uses or where its app and Storybook live.

The two platforms usually run in different CI jobs (a macOS runner with a simulator, a Linux job in
the Playwright image), but a single job on one machine is also valid, for example locally.

## Decision

We will read an optional `targus.config.json` from the working directory (or `--config <path>`),
validated with zod. It names the platforms the project captures and the settings of each:

```json
{
  "platforms": {
    "ios": { "app": "build/ExampleApp.app", "deviceName": "iPhone 16", "appearance": "light" },
    "web": { "storybook": "storybook-static", "viewport": "1200x900", "pixelRatio": 1 }
  }
}
```

- `targus run` captures every platform in the file, in the order ios, android, web, each as its
  own build with its own check run. `--platform <list>` (for example `--platform web` or
  `--platform ios,web`) picks some of them.
- Flags override the file. Without a file, `--platform` defaults to `ios`, so every existing
  command line keeps working.
- When a run covers more than one platform, each writes its capture to its own subdirectory of
  `--out`, a failure on one platform does not stop the others, and the command exits with the
  first failure's code once all have run.
- `targus capture` captures one platform: `--platform`, or the only platform in the file.
- Secrets (the project token, the API URL) stay in the environment, never in the file.

## Consequences

### Positive

- A project states in one reviewed file what it captures and how.
- CI can run each platform in its own job with `--platform`, or both in one job, with the same
  file.
- Existing flag-only setups are unchanged.

### Negative

- One more input to validate and document, and two places a setting can come from.
- Machine-specific settings (a simulator UDID) do not belong in the file; they stay flags.

## Alternatives considered

- **Flags only.** Works, but a two-platform project repeats long command lines in CI and in docs.
- **A JavaScript config file.** More flexible, but it executes code from the repository inside the
  CLI and needs a loader; JSON is enough for paths and a few values.
- **A `targus` key in `package.json`.** Ties the config to the JavaScript package layout, which a
  monorepo may not have at the directory CI runs in.
