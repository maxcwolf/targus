## What and why

<!-- One or two sentences. The PR title must be a Conventional Commit, e.g. `feat: add compare command`. -->

## Reviewer checklist

- [ ] **Does this change a port or a contract** (`packages/core/src/ports/`, `packages/core/src/contracts/`)?
      If yes: is there a test for the new behaviour, and an ADR in `docs/adr/`?
- [ ] **Does this add a dependency?** If yes: why, and why not something already in the repo?
      (Adding one to `packages/core` also needs the `.dependency-cruiser.cjs` allowlist changed.)
- [ ] **Does this touch a guard file** (`.dependency-cruiser.cjs`, `tsconfig.base.json`,
      `eslint.config.js`, a `vitest.config.ts` threshold, `lefthook.yml`, `AGENTS.md`)?
      If yes: why? Coverage thresholds only go up; a lowered one must be justified here.

- [ ] `yarn check` passes locally, and a changeset is included for user-facing package changes.
