# @targus/api

The targus service: one Cloudflare Worker (Hono, Drizzle on D1, R2) that serves the JSON API
under `/api/*` and the built review UI (`apps/web/dist`) for every other path. Design:
[docs/plan.md](../../docs/plan.md) sections 5.2, 6 and 9; layering: [AGENTS.md](../../AGENTS.md).

```
src/routes/        HTTP only: parse with a core zod contract, call one service, map the result
src/middleware/    projectAuth / adminAuth (bearer), sessionAuth / readerAuth (cookie), cookies,
                   JSON body parsing
src/services/      use-cases; the only place rules live outside packages/core
src/repositories/  D1 via Drizzle (projects, builds + snapshots, approvals, images, users,
                   sessions, org membership cache)
src/storage/       R2ImageStore (bytes in R2, "missing" answered by the images table)
src/adapters/      Clock, IdGenerator, tokens, GitHub App client (Octokit or no-op), GitHub OAuth
src/composition.ts wires the real adapters for a request's bindings
```

## Routes (M3)

| Route                                 | Auth                     | Purpose                                                        |
| ------------------------------------- | ------------------------ | -------------------------------------------------------------- |
| `GET /api/health`                     | none                     | Liveness and version                                           |
| `POST /api/admin/projects`            | `ADMIN_TOKEN`            | Create a project (and its org); returns the token once         |
| `GET /api/auth/github?returnTo=`      | none                     | Start GitHub login: state cookie, 302 to GitHub                |
| `GET /api/auth/github/callback`       | state cookie             | Finish login: session cookie, 302 to `returnTo` (a local path) |
| `POST /api/auth/logout`               | session                  | Delete the session and clear the cookie (204)                  |
| `GET /api/me`                         | session                  | The signed-in GitHub user                                      |
| `GET /api/projects`                   | session                  | Projects of the orgs the user belongs to                       |
| `GET /api/projects/:id/builds?limit=` | session                  | Builds, newest first, with summary and counts (limit 1..100)   |
| `POST /api/builds`                    | project token            | Open a build: baseline, baseline hashes, missing image hashes  |
| `PUT /api/images/:hash`               | project token            | Upload a PNG (`Content-Type: image/png`, at most 10 MB)        |
| `GET /api/images/:hash`               | session or project token | Read a PNG                                                     |
| `POST /api/builds/:id/results`        | project token            | Submit story results; stores snapshots, creates check run      |
| `GET /api/builds/:id`                 | session or project token | Build (with `checkRunId`), its status summary and counts       |
| `GET /api/builds/:id/snapshots`       | session or project token | Snapshots of a build                                           |
| `POST /api/snapshots/:id/review`      | session                  | `{ "decision": "approve" \| "deny" }`; updates the check run   |
| `POST /api/builds/:id/approve-all`    | session                  | Approve every pending change; answers `approvedCount`          |

Every body and response is a zod contract from `@targus/core`. A build's `summary.status` is
`in_progress` (no conclusion, every count 0) until its results arrive, then the fold of its
snapshots; `counts` is how many snapshots are in each state. Both come from the tally stored on
the build row, so the builds list never reads snapshots. `build.checkRunId` is the `targus/ios`
check run, or null when none was created. Only `passed` and `accepted` builds (core's
`baselineBuildStatuses`) serve as baselines, so a build still `pending` review is never the
baseline of the next one. Errors are `{ "error": { "code", "message" } }`, with the code mapped
to a status in `src/errors.ts`.

"session or project token": a request with an `Authorization` header is authenticated as a
project token (the CLI), any other by its session cookie (the review UI, including its `<img>`
tags). A project token never sees another project's builds (404). A reviewer sees a project only
while they are a member of its GitHub org: membership is asked of GitHub through the org's App
installation and cached for an hour in `org_memberships`; an org without an installation is
visible to nobody. A build outside the reviewer's orgs answers 403; an image they may not read
answers 404, like one that does not exist.

Reviews: only `changed` and `new` snapshots of a build that has its results can be reviewed (409
otherwise); repeating a decision is a no-op. Approving records the snapshot's hash pair in
`approvals`, so later builds carry it forward (plan.md section 6, rule 3); denying removes that
pair's approval. After each decision the build's status and tally are recomputed and its check
run is updated (best effort: a GitHub failure is logged, the review is kept).

Sessions: `targus_session` holds the session id, signed with `SESSION_SECRET`, `HttpOnly`,
`SameSite=Lax`, `Path=/`, 30 days, `Secure` when `PUBLIC_URL` is https. `SameSite=Lax` is the
CSRF defence for the session POSTs. The OAuth `state` travels in a signed 10-minute
`targus_oauth` cookie.

## Configuration

Vars live in `wrangler.jsonc` and are validated by `src/config.ts`:

| Name                     | Kind   | Default                  | Meaning                                                             |
| ------------------------ | ------ | ------------------------ | ------------------------------------------------------------------- |
| `PUBLIC_URL`             | var    | `http://localhost:8787`  | Origin of the review UI, used for `reviewUrl` and check-run links   |
| `DIFF_THRESHOLD`         | var    | `0.001`                  | Changed-pixel ratio at or under which a snapshot is unchanged       |
| `ADMIN_TOKEN`            | secret | unset                    | Bearer token for `/api/admin/*`; admin routes answer 401 without it |
| `GITHUB_APP_ID`          | secret | unset                    | GitHub App id                                                       |
| `GITHUB_APP_PRIVATE_KEY` | secret | unset                    | GitHub App private key, PKCS#8 PEM                                  |
| `SESSION_SECRET`         | secret | unset                    | Signs the session cookies; session routes answer 401 without it     |
| `GITHUB_CLIENT_ID`       | secret | unset                    | The GitHub App's OAuth client id                                    |
| `GITHUB_CLIENT_SECRET`   | secret | unset                    | The GitHub App's OAuth client secret                                |
| `GITHUB_OAUTH_ORIGIN`    | var    | `https://github.com`     | Where login happens (`/login/oauth/*`)                              |
| `GITHUB_API_ORIGIN`      | var    | `https://api.github.com` | GitHub REST API, for the user lookup and every App call             |

`GITHUB_OAUTH_ORIGIN` and `GITHUB_API_ORIGIN` exist so the e2e suite and local dev can point
login, membership checks and check runs at a stub GitHub instead of the real one.

Set the two GitHub App secrets together or not at all, and likewise the two OAuth secrets.
Without the OAuth pair (or without `SESSION_SECRET`), `GET /api/auth/github` answers 501
`not_implemented`. Without them the no-op GitHub client is
used and no check runs are created. A project's org also needs an `installationId` for its
check runs. GitHub hands out PKCS#1 keys (`BEGIN RSA PRIVATE KEY`), but WebCrypto only imports
PKCS#8, so convert the key first:

```sh
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in app.private-key.pem -out app.pkcs8.pem
```

In production, set secrets with `wrangler secret put ADMIN_TOKEN` (and likewise for the GitHub
ones and `SESSION_SECRET`, e.g. `openssl rand -base64 32`), and override `PUBLIC_URL` for the
deployed origin.

### GitHub App setup

One GitHub App ("targus") provides login, org membership and check runs (ADR 0007):

- **Callback URL**: `${PUBLIC_URL}/api/auth/github/callback`, for example
  `http://localhost:8787/api/auth/github/callback` locally.
- **Permissions**: Repository: Checks (read and write), Metadata (read). Organization: Members
  (read), for the membership check.
- "Request user authorization (OAuth) during installation" can stay off; users sign in from
  the review UI.
- The **client id** is on the App's settings page; generate a **client secret** there too. They
  are `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. The App id and private key are
  `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY`.
- Install the App on the org and set the org's `installationId` (the admin route takes it).

## Running locally

Secrets for `wrangler dev` go in `apps/api/.dev.vars`, which is gitignored:

```sh
cat > apps/api/.dev.vars <<'EOF'
ADMIN_TOKEN=dev-admin-token
SESSION_SECRET=dev-session-secret
# Optional; without both, GitHub login answers 501.
# GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
# GITHUB_CLIENT_SECRET=...
# Optional; without both, check runs are skipped and nobody passes the membership check.
# GITHUB_APP_ID=123456
# GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
# Optional: a stub GitHub instead of the real one.
# GITHUB_OAUTH_ORIGIN=http://localhost:9999
# GITHUB_API_ORIGIN=http://localhost:9999
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
real local D1 and R2 bindings (with coverage), then the Node-side drift test. Route tests sign
in with `test/support/session.ts` (`signIn(login)` creates a user and session in D1 and returns
the signed `Cookie` value) and inject GitHub fakes with `appWith(...)` from
`test/support/api.ts`; `src/flows/m3-flow.test.ts` runs the review flow end to end against a
stubbed GitHub API.
