import type { z } from 'zod';

/** A non-2xx response from the targus API. */
class ApiRequestError extends Error {
  override readonly name: string = 'ApiRequestError';
  readonly status: number;

  constructor(status: number, path: string) {
    super(`targus API answered ${status} for ${path}`);
    this.status = status;
  }
}

/**
 * The only `fetch` in the web app (ESLint `no-restricted-globals` outside api-client/). Every
 * response is validated against its shared zod contract from @targus/core before it is used.
 */
export async function getJson<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
): Promise<z.output<Schema>> {
  const response = await fetch(new URL(path, globalThis.location.href), {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new ApiRequestError(response.status, path);
  return schema.parse(await response.json());
}
