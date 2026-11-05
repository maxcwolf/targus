# targus

Visual review for the native, on-device Storybook of a React Native app: CI renders every story
in an iOS simulator, compares it with the accepted baseline, and publishes a GitHub check that
stays pending until each change is approved in a Chromatic-like review UI.

The design is in [docs/plan.md](docs/plan.md); the rules and their guards are in
[docs/engineering-standards.md](docs/engineering-standards.md); decisions are in
[docs/adr/](docs/adr/). Contributors (and agents) start with [AGENTS.md](AGENTS.md).

## Develop

Requires Node 22 (`.nvmrc`) and Corepack (Yarn 4 is pinned in `package.json`).

```sh
corepack enable
yarn install                       # also installs the lefthook git hooks
yarn check                         # every guard: types, lint, format, architecture, dead code, tests
yarn test                          # tests with coverage only
yarn playwright install chromium   # once
yarn e2e                           # builds the web app, serves it from a local Worker, runs Playwright
```

Scaffolding: `yarn new:route <name>` and `yarn new:adapter <port> <name>` create files in the
right layer with a test beside them.

## Notes

- `.github/CODEOWNERS` names `@maxcwolf` while the repo lives under that account. Point it at an
  org team when the repo moves, before enabling "require review from code owners".
- `spike/` is the throwaway M0 capture spike. It is not a workspace and no guard checks it.
