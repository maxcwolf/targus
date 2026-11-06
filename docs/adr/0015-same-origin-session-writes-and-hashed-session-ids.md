# 0015. Same-origin checks on session writes, and hashed session ids

## Status

accepted

## Date

2026-11-06

## Context

Reviewers authenticate with the `targus_session` cookie (ADR 0011): signed, `HttpOnly`,
`SameSite=Lax`. The cookie's value is the session id, and until now the `sessions` table stored
that id as it is. ADR 0011 named `SameSite=Lax` plus JSON bodies as the whole CSRF defence; this ADR replaces that
part of it.

Lax falls short in three ways:

- **Same-site is wider than same-origin.** A browser sends a Lax cookie on any request from the
  same *site* (scheme plus registrable domain). The production Worker is on `workers.dev`, which
  is on the Public Suffix List, so other Workers are other sites there today. A custom domain
  would make every sibling subdomain (`docs.example.com`, a preview deploy, a hijacked
  `staging.example.com`) same-site, so a page there could approve or deny snapshots with the
  reviewer's cookie.
- **It depends on the browser.** Lax-by-default and the cookie's `SameSite` attribute are
  enforced by the browser, and older browsers or embedded webviews may not enforce them.
- **"JSON only" is a property of each route, not a rule.** `POST /api/builds/:id/approve-all` and
  `POST /api/auth/logout` take no body, so a cross-origin form post would reach them if a
  browser ever attached the cookie.

The session id in D1 has a separate problem: anyone who reads the table (a leaked backup, a
query with too wide a scope, a D1 export) gets ids that are valid cookies once signed, and since
`SESSION_SECRET` sits in the same Worker, one leak tends to come with the other. Project tokens
already avoid this by storing only their SHA-256.

## Decision

**Session writes must be same-origin.** A POST, PUT, PATCH or DELETE that is authenticated by the
session cookie is refused with `forbidden` (403) unless:

- its `Sec-Fetch-Site` header, when present, is `same-origin`;
- its `Origin` header, when present, equals the origin of `PUBLIC_URL`; and
- at least one of the two is present. Every current browser sends `Origin` on a POST, so a
  write with neither header did not come from a browser we can trust to have said where it came
  from.

GET, HEAD and OPTIONS are not checked: reads change nothing, and a cross-origin page cannot read
the response. The check runs after the session is authenticated, so a request without a valid
cookie still answers 401. The rule is `assertSameOrigin` in
`apps/api/src/services/origin.service.ts`; the `sessionAuth` and `readerAuth` middleware call it
for every cookie-authenticated request.

**Bearer-token requests are exempt.** A request with an `Authorization` header is authenticated
as a project token and never reaches the check. A browser attaches cookies by itself but never an
`Authorization` header, so another site cannot forge one, and the CLI sends no `Origin`.

**We verify headers, not a token.** The review UI needs no change: the browser adds `Origin` and
`Sec-Fetch-Site` to its same-origin `fetch` calls already. The cookie stays `SameSite=Lax` as a
second layer.

**The sessions table stores the SHA-256 of the session id.** The id itself (48 url-safe
characters, 288 random bits, from the `Tokens` adapter) goes only into the signed cookie. Sign-in,
lookup and logout hash the cookie's value with Web Crypto (`Tokens.hash`, the same function as
project tokens). The column is `sessions.id_hash`. Migration `0005_hashed_session_ids` drops and
recreates the table: D1's SQL has no SHA-256 function to convert the old rows, and converting
would only save each reviewer one sign-in.

**Expired sessions are deleted at sign-in.** `completeLogin` deletes every session whose
`expires_at` is at or before now (the `sessions_expires_at_idx` index). Sessions are only ever
created at sign-in, so an expired row survives only until the next sign-in, and `findActive`
never accepts one meanwhile. This needs no Cron Trigger, no `scheduled` handler and no binding.

## Consequences

### Positive

- A page on another origin, including a same-site subdomain, cannot approve, deny, approve-all
  or log a reviewer out, whatever the browser does with `SameSite`.
- A copy of the `sessions` table holds no usable session id.
- The table stays bounded by recent sign-ins without a scheduled job.

### Negative

- Deploying migration 0005 signs every reviewer out once. This must be known before the deploy.
- `PUBLIC_URL` must be the origin the browser is on. The Vite dev server (`localhost:5173`, which
  proxies `/api` to the Worker) needs `PUBLIC_URL=http://localhost:5173` in `.dev.vars`, or
  writes answer 403. A second hostname for the same Worker (a custom domain next to
  `workers.dev`) can only write from the one `PUBLIC_URL` names.
- A write from a client that sends neither `Origin` nor `Sec-Fetch-Site` with a session cookie
  (for example `curl` with a copied cookie) is refused; such clients should use a project token
  or send the `Origin` header.
- With no sign-ins, expired rows stay in the table. They are never accepted, and the next
  sign-in removes them.

## Alternatives considered

- **SameSite=Lax alone (ADR 0011).** Kept as a layer, not the defence, for the reasons above.
- **SameSite=Strict.** Still same-site, not same-origin, and it drops the cookie when a reviewer
  follows a link to a build from a GitHub check run, which is the main way in.
- **A synchronizer or double-submit CSRF token.** Works on any browser, but the web app would
  have to read and send the token on every write, and a token adds state for what the browser's
  own headers already say.
- **Requiring a custom request header** (for example `X-Requested-With`). About as strong, since
  a cross-origin page cannot add one without a CORS preflight, but it needs a web app change to
  say what `Origin` and `Sec-Fetch-Site` already say.
- **Converting the old session rows** to hashes with a one-off Worker script. More moving parts
  to save one sign-in per reviewer.
- **A Cron Trigger for cleanup.** Needs a `scheduled` handler and a schedule to configure and
  test, for rows that are already harmless.
