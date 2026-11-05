# @targus/api

The targus service: one Cloudflare Worker (Hono, Drizzle on D1, R2) that serves the JSON API
under `/api/*` and the built review UI (`apps/web/dist`) for every other path. Design:
[docs/plan.md](../../docs/plan.md) sections 5.2, 6 and 9; layering: [AGENTS.md](../../AGENTS.md).

```
src/routes/        HTTP only: parse with a core zod contract, call one service, map the result
src/middleware/    projectAuth / adminAuth (bearer tokens), JSON body parsing
src/services/      use-cases; the only place rules live outside packages/core
src/repositories/  D1 via Drizzle (projects, builds + snapshots, approvals, images)
src/storage/       R2ImageStore (bytes in R2, "missing" answered by the images table)
src/adapters/      Clock, IdGenerator, tokens, GitHub App client (Octokit or no-op)
src/composition.ts wires the real adapters for a request's bindings
```

## Routes (M2)

| Route                           | Auth          | Purpose                                                        |
| ------------------------------- | ------------- | -------------------------------------------------------------- |
| `GET /api/health`               | none          | Liveness and version                                           |
| `POST /api/admin/projects`      | `ADMIN_TOKEN` | Create a project (and its org); returns the token once         |
| `POST /api/builds`              | project token | Open a build: baseline, baseline hashes, missing image hashes  |
| `PUT /api/images/:hash`         | project token | Upload a PNG (`Content-Type: image/png`, at most 10 MB)        |
| `GET /api/images/:hash`         | project token | Read a PNG (moves to session auth in M3)                       |
| `POST /api/builds/:id/results`  | project token | Submit story results; stores snapshots, creates check run      |
| `GET /api/builds/:id`           | project token | Build (with `checkRunId`) and its status summary (M3: session) |
| `GET /api/builds/:id/snapshots` | project token | Snapshots of a build (session auth in M3)                      |

Every body and response is a zod contract from `@targus/core`. A build's `summary.status` is
`in_progress` (no conclusion, every count 0) until its results arrive, then the fold of its
snapshots; `build.checkRunId` is the `targus/ios` check run, or null when none was created. Only
`passed` and `accepted` builds (core's `baselineBuildStatuses`) serve as baselines, so a build
still `pending` review is never the baseline of the next one. Errors are
`{ "error": { "code", "message" } }`, with the code mapped to a status in `src/errors.ts`.
A build of another project answers 404.

## Configuration

Vars live in `wrangler.jsonc` and are validated by `src/config.ts`:

| Name                     | Kind   | Default                 | Meaning                                                             |
| ------------------------ | ------ | ----------------------- | ------------------------------------------------------------------- |
| `PUBLIC_URL`             | var    | `http://localhost:8787` | Origin of the review UI, used for `reviewUrl` and check-run links   |
| `DIFF_THRESHOLD`         | var    | `0.001`                 | Changed-pixel ratio at or under which a snapshot is unchanged       |
| `ADMIN_TOKEN`            | secret | unset                   | Bearer token for `/api/admin/*`; admin routes answer 401 without it |
| `GITHUB_APP_ID`          | secret | unset                   | GitHub App id                                                       |
| `GITHUB_APP_PRIVATE_KEY` | secret | unset                   | GitHub App private key, PKCS#8 PEM                                  |

Set the two GitHub secrets together or not at all. Without them the no-op GitHub client is
used and no check runs are created. A project's org also needs an `installationId` for its
check runs. GitHub hands out PKCS#1 keys (`BEGIN RSA PRIVATE KEY`), but WebCrypto only imports
PKCS#8, so convert the key first:

```sh
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in app.private-key.pem -out app.pkcs8.pem
```

In production, set secrets with `wrangler secret put ADMIN_TOKEN` (and likewise for the GitHub
ones), and override `PUBLIC_URL` for the deployed origin.

## Running locally

Secrets for `wrangler dev` go in `apps/api/.dev.vars`, which is gitignored:

```sh
cat > apps/api/.dev.vars <<'EOF'
ADMIN_TOKEN=dev-admin-token
# Optional; without both, check runs are skipped.
# GITHUB_APP_ID=123456
# GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
EOF

yarn workspace @targus/api db:migrate:local   # apply migrations/ to the local D1
yarn workspace @targus/web build             # the UI the Worker serves (optional for the API)
yarn workspace @targus/api dev               # http://localhost:8787
```

### Creating a project and a build with curl

```sh
B=http://localhost:8787

# 1. Create a project. Keep the token: it is shown once, and only its hash is stored.
curl -s $B/api/admin/projects \
  -H 'Authorization: Bearer dev-admin-token' -H 'Content-Type: application/json' \
  -d '{"githubOrg":"example-org","installationId":null,"repo":"example-org/example-app","name":"the pilot app"}'
TOKEN=...   # the "token" field of the response

# 2. Open a build. The response lists the image hashes the server still needs.
HASH=$(shasum -a 256 button.png | cut -d' ' -f1)
SHA=$(git rev-parse HEAD)
curl -s $B/api/builds -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"sha\":\"$SHA\",\"branch\":\"main\",\"prNumber\":null,\"mergeBaseSha\":null,\"ancestors\":[],
       \"trigger\":\"main\",\"device\":\"iPhone 17\",
       \"snapshots\":[{\"storyId\":\"button--primary\",\"imageHash\":\"$HASH\",\"width\":1179,\"height\":2556}]}"
BUILD=...   # the "build.id" field of the response

# 3. Upload each missing image (idempotent; the body's sha256 must equal the path hash).
curl -s -X PUT $B/api/images/$HASH -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: image/png' --data-binary @button.png

# 4. Submit the results. The server recomputes each state against the baseline and approvals.
curl -s $B/api/builds/$BUILD/results -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"durationMs\":1200,\"results\":[{\"storyId\":\"button--primary\",\"state\":\"new\",
       \"imageHash\":\"$HASH\",\"width\":1179,\"height\":2556,\"diffHash\":null,\"diffRatio\":null,
       \"error\":null,\"blank\":false}]}"

# 5. Read it back.
curl -s $B/api/builds/$BUILD -H "Authorization: Bearer $TOKEN"
curl -s $B/api/builds/$BUILD/snapshots -H "Authorization: Bearer $TOKEN"
```

## End-to-end suite

`yarn e2e` (from the repo root) runs the API against Playwright: the webServer in
`e2e/playwright.config.ts` deletes `e2e/.wrangler/state`, applies the migrations there
(`db:migrate:local --persist-to`), and starts `wrangler dev --persist-to e2e/.wrangler/state
--var ADMIN_TOKEN:e2e-admin-token`, so each run starts from an empty D1 and R2 and the admin
route works without a `.dev.vars`. `e2e/run.spec.ts` creates a project, then publishes the CLI's
fixture capture twice with `targus run --from-capture` (a `main` build and a PR build).

## Database

`src/db/schema.ts` is the source of truth. After changing it, run
`yarn workspace @targus/api db:generate` and commit the new file in `migrations/`. The drift
test (`test/node/migration-drift.test.ts`, part of `yarn test`) fails when the schema and the
committed migrations disagree.

## Tests

`yarn workspace @targus/api test` runs every `src/**/*.test.ts` inside workerd against the
real local D1 and R2 bindings (with coverage), then the Node-side drift test.
