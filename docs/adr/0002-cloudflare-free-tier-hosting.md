# 0002. Cloudflare free tier hosting: Workers, R2 and D1

## Status

accepted

## Date

2026-11-04

## Context

The hosted service (ADR 0001) needs an HTTP API, a static web app, image storage and a small
metadata store. The free tier must cover the hosted services; CI minutes come from the pilot app's
existing CircleCI plan.

## Decision

We will host on Cloudflare: Workers run the API (Hono, Drizzle) and serve the built web app as
static assets, R2 stores images content addressed by SHA-256, and D1 stores metadata. Deploys
use Wrangler. Free-tier budget from plan.md section 9:

| Service | Free allowance | targus usage estimate |
| --- | --- | --- |
| R2 | 10 GB storage, 1M class A, 10M class B ops/month | About 180 images at about 200 KB, so about 36 MB stored once; a typical PR adds a few MB thanks to hashing |
| D1 | 5 GB, 5M row reads/day, 100k row writes/day | About 200 writes per build; index every foreign key to keep row reads low |
| Workers | 100k requests/day | About 200 API calls per build; review image fetches count, so cap at a few thousand per day |

Caveats: D1 queries fail past the limit from September 2026. Image views through the Worker
count against the request limit, and presigned R2 URLs are the escape hatch if that gets
tight. A v1.1 retention job deletes images unreferenced for 90 days (R2 deletes are free). The
numbers must be re-checked against the official pages when the Cloudflare account is set up.

Sources: [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[D1 free tier limit enforcement changelog](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/),
[D1 FAQ](https://developers.cloudflare.com/d1/reference/faq/), and third-party summaries at
[eastondev](https://eastondev.com/blog/en/posts/dev/20260526-cloudflare-free-limits/) and
[HelpPuff](https://github.com/knowtific/helppuff/wiki/Cloudflare-Free-Plan).

## Consequences

### Positive

- API, web app, storage and database share one platform and one deploy tool.
- Content addressing keeps R2 growth small; hundreds of builds fit in the allowance.
- `@cloudflare/vitest-pool-workers` tests the API against local D1 and R2.

### Negative

- Workers' small per-request CPU budget rules out server-side diffing (ADR 0003).
- Hitting a D1 limit fails queries instead of degrading, so row reads need indexes.

## Alternatives considered

- **Supabase plus Vercel.** Hosted Postgres and storage with a separate API and web host. Not
  chosen; Cloudflare keeps everything on one platform with one deploy tool.
- **Fly or Railway.** Container hosting for a conventional server. Not chosen; it means running
  and sizing a server process rather than a thin Worker over managed storage.
