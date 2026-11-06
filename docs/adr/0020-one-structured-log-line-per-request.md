# 0020. One structured log line per request, with a request id and no secrets

## Status

accepted

## Date

2026-11-06

## Context

The API had no request ids and wrote nothing to the log except `console.error(error)` for an
unexpected error. A reviewer reporting "the page said Internal Server Error" gave us nothing to
search for, and a 403 or 401 left no trace at all. Workers Logs is already on
(`observability.enabled` in `wrangler.jsonc`) and indexes the fields of a JSON line written to
`console`, so structured lines cost nothing extra on the free tier.

The API handles credentials on almost every request: project tokens and the admin token in
`Authorization`, the signed session id in the `targus_session` cookie, the OAuth `code` and
`state`, PNG bytes and result bodies. A log that copies a header, a query string or a body would
hold usable secrets, and Workers Logs is readable by everyone with access to the Cloudflare
account.

## Decision

We will give every request an id and write exactly one JSON line for it.

- `requestLogger` (`apps/api/src/middleware/request-log.ts`) runs before every other middleware.
  It takes the id from the `IdGenerator` port, never from the client, and returns it in the
  `x-request-id` response header. Error bodies carry it too, as `error.requestId`; the clients
  parse the error object without `strict`, so the field is additive.
- When the response is ready, the middleware writes one line through an injected `Logger`
  (`consoleLogger` on the Worker, a capturing one in tests). Durations come from the `Clock`
  port.
- A line holds only these fields: `level`, `event` (`request`), `requestId`, `cfRay` (the
  `cf-ray` request header, to join with Cloudflare's own logs), `method`, `route` (the matched
  pattern such as `/api/builds/:id`, never the raw path), `status`, `durationMs`, `principal`
  (`none`, `project`, `reviewer` or `admin`: the kind, never the identity), and when present
  `error` and `warnings`.
- `error` is the `TargusError` code alone (its message can name a user or an org), `http_<status>`
  for an `HTTPException`, or for anything unexpected `internal` with the message and stack.
- `warnings` is what a use-case noticed without failing the request, written through the
  `ServiceLog` in `ServiceDeps.log`: an event name with identifiers and counts (for example
  the GitHub orgs whose membership could not be checked, or a best-effort check-run call that
  failed, with the HTTP status or error message as its reason). Services never pass request data
  to it, and never write to `console` themselves, so a request still has exactly one line.
- Never logged: request or response headers, cookies, tokens, session ids, query strings,
  request or response bodies, image bytes, user logins or ids. A test sends a project token, a
  session cookie, the admin token and a body marker through the app and asserts that none of
  them appears in the lines.

The fields are typed in `apps/api/src/logging/request-log.ts`; adding a field means changing
that type, so a reviewer sees every new thing that reaches the log.

## Consequences

### Positive

- A user can quote the `requestId` from an error body or the response header, and one search in
  Workers Logs finds the line, with `cfRay` linking it to Cloudflare's request log.
- Latency, error rates and auth failures can be read per route pattern without parsing paths.
- An unexpected error is logged once, with its stack, by the same code that logs every request.

### Negative

- Every request costs one log line; at the free tier's daily log allowance this is fine for
  targus's traffic, but it is a volume to watch if usage grows.
- A line says what kind of principal made the request but not who, so tracing one user's
  activity needs their report of a request id.
- An unexpected error's message is logged as is. A library that put a secret in an error message
  would leak it into the log; the GitHub and D1 clients in use do not.

## Alternatives considered

- **`hono/logger`.** Prints the method, raw path and status as text: no id, no route pattern,
  no principal, and the raw path carries ids and hashes.
- **Honour an incoming `x-request-id`.** A client could then choose ids that collide with
  others' or inject text into the log. Cloudflare's `cf-ray` is recorded instead.
- **Log the `TargusError` message.** More readable, but messages name orgs and are written for
  users; the code plus the route is enough to find the cause.
- **A third-party log drain (Sentry, Logpush).** Needs a paid plan or a secret per environment;
  Workers Logs already stores and indexes the lines.
