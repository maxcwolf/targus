# 0023. The API is built from plain dependencies behind a thin Worker entry

## Status

accepted

## Date

2026-11-06

## Context

`apps/api` ran only as a Cloudflare Worker, and Cloudflare's shapes reached every layer. Every
Hono env type in `app-env.ts` carried the `Bindings` interface (`D1Database`, `R2Bucket`), so
every route and middleware was typed against the Worker `env`. `createApp` took a
`(bindings, log) => Services` factory, which a middleware called on every request with `c.env`.
`createDeps` then parsed the config with zod and built eight D1 repositories (each wrapping the
binding in a new drizzle instance), the R2 image store, the GitHub App client and the OAuth
client, again on every request. The health route read `c.env` itself.

So the app could not be constructed without a Worker `env`, and nothing showed that it could run
anywhere else. The owner wants leaving Cloudflare to stay cheap: a Node entry with SQLite and a
file or S3 image store should be a new entry and new adapters, not a rewrite. Later items build
on this: repository interfaces in a ports file, a second `ImageStore`, and a Node entry that CI
runs the e2e suite against.

The installation-token cache (`InstallationTokenCache`) already lives for the isolate; nothing
else needed to be per request except the request's log line (ADR 0020) and what the
authentication middleware puts on the context.

## Decision

We will build the Hono app from plain dependencies and keep Cloudflare at the edge.

- `createApp(deps: AppDeps, observe?)` (`apps/api/src/app.ts`) takes every service dependency
  except the request log: repositories, image store, GitHub client, OAuth client, clock, id
  generator, tokens and the validated `ApiConfig`. Per request it makes only the `RequestLog`
  and binds the services to it (`bindServices({ ...deps, log })`, a handful of closures).
  `app-env.ts` has no `Bindings`; routes, middleware and services never read `c.env`. The
  health route asks a service (`getHealth`) instead of parsing the config itself.
- `apps/api/src/composition.ts` is the neutral half of the composition root: `createAppDeps
  (config, storage)` adds the real clock, ids, tokens and the GitHub clients chosen from the
  config to the storage a host supplies (`StorageDeps`). `config.ts` validates plain
  `ConfigVars` (string variables) and knows nothing of Workers.
- `apps/api/src/cloudflare/` holds everything Cloudflare-specific above the adapters:
  `bindings.ts` (`Bindings extends ConfigVars` plus `DB` and `IMAGES`), `worker-deps.ts`
  (`createWorkerDeps(env)`: validate the config, build the D1 repositories and the R2 store) and
  `worker.ts`, the Worker entry (wrangler `main`). The entry builds the app once per `env`
  object, kept in a `WeakMap`, and hands each request to it. In practice the runtime passes the
  same `env` for the life of an isolate, so the config is parsed and the adapters are built once
  per isolate; if it ever passed a new `env`, the entry would build again, which is today's cost.
- Request-scoped state stays on the Hono context: the log, the bound services, the principal,
  project or reviewer. `src/app.test.ts` sends concurrent and sequential requests through one
  app and checks that each response's log line has its own id, principal and warnings, and that
  a signed-in reviewer is not carried over.
- The boundary is a guard. Dependency-cruiser rule `api-cloudflare-only-at-the-edge`: under
  `apps/api/src/`, only `cloudflare/`, `repositories/` (the D1 adapters) and `storage/r2-*` may
  import `cloudflare:*`, `@cloudflare/*` or `drizzle-orm/d1`, and nothing else may import
  `src/cloudflare/`. Tests run inside workerd and are exempt. Cloudflare's types are ambient
  globals, which no import reveals, so ESLint `targus/api-no-cloudflare-types` bans the names
  (`D1Database`, `R2Bucket`, `ExecutionContext`, `ExportedHandler`, `Cloudflare.Env`, ...) in
  the same files with `@typescript-eslint/no-restricted-types`.

## Consequences

### Positive

- The app can be constructed from in-memory or any other adapters; another host needs an entry
  and `StorageDeps`, nothing in routes, middleware or services.
- Config parsing and adapter construction move from every request to once per isolate.
- Route tests build the app straight from deps and no longer pass an `env` to `app.request`.
- A Cloudflare type or import outside the edge fails `yarn check`.

### Negative

- An invalid configuration now fails when the entry builds the app, as an uncaught exception
  (a Cloudflare 500 page and an exception in Workers Logs), instead of a JSON 500 with a request
  line. It fails every request either way; only the body differs, and only for a broken deploy.
- Neutral code still imports the repository modules for their interfaces (`services/deps.ts`),
  and those modules import drizzle D1. The rule checks direct imports only; moving the
  interfaces to a ports file is a separate step.
- Adapters built once per isolate must hold no request state. Today none does; a new adapter
  that caches per request would have to be built in the request middleware instead.

## Alternatives considered

- **Keep building per request, only drop the types.** Simpler, but it keeps paying the zod parse
  and the adapter construction on every request for no benefit.
- **Read the env through `import { env } from 'cloudflare:workers'` at module scope.** It builds
  once too, but ties module evaluation to the Workers runtime and makes the app module itself
  Cloudflare-specific, which is what this decision removes.
- **Only a dependency-cruiser rule.** It cannot see ambient global types, so `D1Database` in a
  service would pass; the ESLint rule covers that half.
