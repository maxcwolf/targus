# @targus/cli

The `targus` binary: captures on-device Storybook stories in an iOS simulator, diffs them against
the accepted baselines on the CI runner, and publishes the build to the targus service for review.

```sh
targus capture --udid <simulator-udid> --app build/MyApp.app --out visual/current   # offline
TARGUS_TOKEN=... targus run --udid <simulator-udid> --app build/MyApp.app           # CI
```

- [CLI reference](../../docs/reference/cli.md): every command and flag (generated from
  `--help`), environment, timeouts and retries, exit codes.
- [Quickstart](../../docs/guide/quickstart.md) and
  [Run targus in GitHub Actions](../../docs/guide/ci-github-actions.md).
- [Troubleshooting](../../docs/guide/troubleshooting.md): every error message and its fix.

Design background: [docs/plan.md](../../docs/plan.md) sections 4, 5.1 and 8, ADRs 0003 and 0004.

## Fixtures

`yarn workspace @targus/cli fixture:capture <absolute-dir>` builds the package and writes a
three-story capture (two solid colours and a gradient, 24x48 px) with a valid `manifest.json`, for
end-to-end tests of `targus run --from-capture`. The same data is available programmatically as
`fixtureCaptureReport()` and `writeFixtureCapture(dir)`. The path is resolved against
`packages/cli`, so pass an absolute one. `e2e/run.spec.ts` imports `writeFixtureCapture` and runs
the built `dist/bin.js` against a local Worker (`yarn e2e` builds the package first).
