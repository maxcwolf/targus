/** Worker bindings declared in wrangler.jsonc. Keep the two in step. */
export interface Bindings {
  readonly DB: D1Database;
  readonly IMAGES: R2Bucket;
  readonly APP_VERSION: string;
}

/** Hono environment shared by every route. */
export interface AppEnv {
  Bindings: Bindings;
}
