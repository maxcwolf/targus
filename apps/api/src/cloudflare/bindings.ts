import type { ConfigVars } from '../config.ts';

/**
 * Worker bindings declared in wrangler.jsonc (D1, R2 and vars) or set with `wrangler secret put`
 * / `.dev.vars` (secrets). The variables are `ConfigVars`, documented and validated in
 * `config.ts`; keep wrangler.jsonc in step with it. Only `src/cloudflare/` sees this type.
 */
export interface Bindings extends ConfigVars {
  readonly DB: D1Database;
  readonly IMAGES: R2Bucket;
}
