# Hosting targus elsewhere: Kubernetes, Postgres and S3

targus runs today on Cloudflare: the API is a Worker, the database is D1 (SQLite), the images
are in R2 and the web app is served next to the Worker. This page says what it would take to run
the same code on a different stack, and which changes keep that switch cheap. The reference
target is a common company stack: a Kubernetes cluster (EKS) running containers deployed with Helm, Postgres on RDS,
S3 for objects, secrets injected as environment variables, Terraform for infrastructure, Datadog
for logs, and CircleCI for the mobile app's CI (macOS executors for iOS). Nothing on this page
depends on those exact products; any host with a container runtime, Postgres and an S3-compatible
store fits the same way.

## What is already host-neutral

| Piece                       | State                                                                                                                                                                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The app itself              | `createApp(deps)` takes plain dependencies (ADR 0023). Routes, middleware and services never see a Cloudflare type; two guards (`api-cloudflare-only-at-the-edge`, `targus/api-no-cloudflare-types`) keep it so.                                                                                           |
| Composition                 | `apps/api/src/composition.ts` joins a host's `StorageDeps` (repositories plus the image store) with the clock, ids, tokens and GitHub clients. A host supplies storage and config; nothing else.                                                                                                             |
| Config                      | `config.ts` validates plain string variables (`ConfigVars`). On the Worker they are bindings; on a container they are environment variables. No code change.                                                                                                                                            |
| Logs                        | One JSON line per request through an injected `Logger` (ADR 0020), written with `console` on the Worker. A log collector that reads stdout (Datadog, CloudWatch, Fluent Bit) takes it as is.                                                                                                            |
| Images                      | The `ImageStore` port is tiny (put, get, missing) and R2 speaks the S3 API, so the S3 adapter is a second small file beside `storage/r2-image-store.ts`, and `test/support/contracts/image-store.contract.ts` tests both the same way.                                                                      |
| Sign-in and GitHub          | GitHub OAuth and the GitHub App are HTTP calls to GitHub from the API; they do not depend on the host. A new host needs the App installed on the organisation and its id, private key and OAuth client in the config, nothing more.                                                                      |
| The CLI in CI               | `targus run` reads the branch, sha and pull request from flags, from GitHub Actions variables or from CircleCI's `CIRCLE_BRANCH`, `CIRCLE_PR_NUMBER` and `CIRCLE_PULL_REQUEST`. The CircleCI path has not been exercised on a real job yet (docs/plan.md section 8 describes the planned job).            |
| The web app                 | A static Vite build. It can be served by the same container as the API or from a bucket behind a CDN. Because reviewer writes must be same-origin (ADR 0015), serving it from the API's origin is the simpler choice.                                                                                     |

## What is still Cloudflare-specific

1. **The database.** The drizzle schema (`apps/api/src/db/schema.ts`) uses `sqlite-core`, the
   twelve repository files under `apps/api/src/repositories/` wrap a `D1Database`, the batched
   writes of ADR 0013 use D1's `batch`, and the migrations under `apps/api/migrations/` are
   SQLite SQL. The in-memory doubles copy SQLite's semantics (text ordering, unique-key
   rejection). This is the one piece of real work in a move.
2. **The entry.** `apps/api/src/cloudflare/worker.ts` is the only entry. A container needs a Node
   entry that reads `process.env`, builds `StorageDeps` and serves `createApp` with
   `@hono/node-server`.
3. **The image store.** Only the R2 adapter exists.
4. **Local development and e2e.** `yarn dev:local` and the Playwright suite start `wrangler dev`.

## The changes that make the switch cheap

In the order they should land. Each one is a tracker item.

### 1. Repository interfaces in a ports file (E2)

Today each repository interface lives in the D1 file that implements it, so a service that
imports the interface also imports `drizzle-orm/d1`. Move the interfaces and row types into
`apps/api/src/ports/`, repoint the services and the doubles, then tighten the guard so that
neutral code imports `repositories/` and `storage/` nowhere. After this, a Postgres
implementation is a new directory, not an edit.

### 2. An S3 `ImageStore` adapter (E3)

`storage/s3-image-store.ts`, built on signed HTTP requests (no new dependency in `core`; the API
may take the AWS SDK or a small signer), run through the existing image-store contract suite
against a local S3-compatible server (MinIO or LocalStack) and against R2, which also speaks S3.

### 3. Postgres repositories

- A Postgres drizzle schema beside the SQLite one, generated migrations for Postgres, and a
  repository implementation per interface using `drizzle-orm/node-postgres` (or `postgres-js`).
- The batched writes of ADR 0013 become transactions.
- The contract suites in `apps/api/test/support/contracts/` run unchanged against Postgres. Two
  assertions will show dialect differences and must be decided, not patched around: text
  ordering (SQLite's binary order versus Postgres collation; use the `C` collation or sort in the
  repository) and timestamp formats.
- Tests run against a real Postgres (a container in CI), not a double.

### 4. A Node entry, a container and an e2e run against it (E4)

- `apps/api/src/node/server.ts`: read `process.env` in a `node/config.ts`, build `StorageDeps`
  from Postgres and S3, serve `createApp(createAppDeps(config, storage))` with
  `@hono/node-server`, and serve `apps/web/dist` from the same origin.
- A `Dockerfile` for the API (Node 22, the built packages, the web build) and a Helm chart or a
  compose file as a worked example. Health is `GET /api/health`.
- A CI job that starts the Node entry with Postgres and MinIO and runs the Playwright suite
  against it, so every change is proven on both hosts.
- `yarn dev:local` gains a `--node` mode once this exists.

### 5. The consumer's CI job

The CLI runs on the consumer's CI next to its iOS end-to-end job (docs/plan.md section 8 for a
CircleCI macOS executor). It needs `TARGUS_TOKEN` and `TARGUS_API_URL` from a CI secret store,
nothing else. Running it once on a real CircleCI job is what proves the CircleCI branch and pull
request detection.

## What a host then has to provide

| Need                     | Cloudflare today                | Container host                                                                 |
| ------------------------ | ------------------------------- | ------------------------------------------------------------------------------ |
| Compute                  | Worker                          | One container (Node 22) behind an HTTPS load balancer; one replica is enough     |
| Database                 | D1                              | Postgres; migrations applied before the new image serves traffic               |
| Images                   | R2                              | An S3 bucket, private; the API signs its own requests                          |
| Web app                  | Served next to the Worker       | Served by the same container from `apps/web/dist`                              |
| Config and secrets       | Bindings and `wrangler secret`  | Environment variables (the `ConfigVars` list in `apps/api/src/config.ts`)      |
| GitHub                   | App and OAuth client            | The same App installed on the organisation, with the callback URL updated      |
| Logs                     | Workers Logs                    | stdout to the host's collector                                                 |
| Outbound                 | GitHub API                      | The container must reach `api.github.com` and the OAuth endpoints              |

The database is the only part whose data would have to move; images are content-addressed and
can be copied bucket to bucket, and everything else is config.

## Open questions

- Whether to keep SQLite on Node at all. Running the Postgres repositories everywhere off
  Cloudflare is simpler than carrying three storage implementations.
- Which sign-in a host wants. targus authorises reviewers by GitHub organisation membership, which
  suits an engineering team on GitHub. An organisation that signs staff in with another
  provider would need a second identity path, which is a larger change and not planned.
- Whether screenshots count as sensitive data for the host. They are renders of a component
  library, not user data, but each host decides where they may live.
