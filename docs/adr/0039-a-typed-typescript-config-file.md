# 0039. A typed TypeScript config file

## Status

accepted

## Date

2026-11-08

## Context

ADR 0038 added `targus.config.json` and turned down a JavaScript config file because it "executes
code from the repository inside the CLI and needs a loader". Projects that use targus write their
other tool configs (Storybook, Vite, Playwright, ESLint) in TypeScript and expect their editor to
complete and check the keys. A JSON file gets neither, short of a published JSON schema.

Two facts weaken the reasons ADR 0038 gave:

- Node 22.18 and later run `.ts` files themselves by stripping the types, so `import()` loads a
  TypeScript config with no loader and no new dependency. Node 22 is already the CLI's minimum.
- The CLI already runs the repository's code: it launches the app on a simulator and opens the
  Storybook the repository built. A config file the same repository reviews adds no new trust.

## Decision

We will also read `targus.config.ts`, as a typed alternative to `targus.config.json`.

- Without `--config`, the CLI looks for `targus.config.ts`, then `targus.config.json`, in the
  working directory. A directory with both is an error, so it is never unclear which one applies.
- A `.ts`, `.mts`, `.js` or `.mjs` file is loaded with Node's `import()`, and its default export is
  the config. Any other file, `.json` included, is read as JSON. Both go through the same zod
  schema, with relative paths resolved against the file.
- `@targus/cli` exports `defineConfig` and the `TargusConfig` type, so
  `export default defineConfig({ … })` is checked by the editor. The type is derived from the zod
  schema, so the two cannot drift.
- On a Node that cannot run `.ts` files, the CLI says to upgrade Node or use the JSON file.

## Consequences

### Positive

- Config keys are completed and checked in the editor, as with the project's other tool configs.
- The config can compute values (a path from an environment variable, for example) when a project
  needs it.
- No dependency is added: Node does the loading.

### Negative

- Node's type stripping does not transform code: enums, namespaces and parameter properties are
  refused. A config file has no use for them, but the error comes from Node, not targus.
- A TypeScript config needs Node 22.18 or later, while the JSON file works on any Node 22.
- Loading the config runs code, so a broken config fails with a JavaScript error rather than a
  validation message naming a key.

## Alternatives considered

- **JSON only, with a published JSON schema.** Gives completion through `$schema`, but no
  computed values, and the schema has to be generated, versioned and hosted.
- **A loader dependency (jiti or tsx).** Supports any Node 22 and every TypeScript feature, but
  adds a dependency to the CLI for something Node now does itself.
