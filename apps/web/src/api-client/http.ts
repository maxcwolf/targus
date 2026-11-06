import { z } from 'zod';

/** The API's error body: `{ error: { code, message } }` (apps/api/src/errors.ts). */
const ApiErrorBody = z.object({
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }),
});

/** A non-2xx response from the targus API, with the error code when the body carried one. */
export class ApiRequestError extends Error {
  override readonly name: string = 'ApiRequestError';
  readonly status: number;
  /** The API error code (`forbidden`, `not_found`, ...), or null when the body had none. */
  readonly code: string | null;

  constructor(status: number, path: string, body: unknown) {
    const parsed = ApiErrorBody.safeParse(body);
    super(parsed.success ? parsed.data.error.message : `targus API answered ${status} for ${path}`);
    this.status = status;
    this.code = parsed.success ? parsed.data.error.code : null;
  }
}

/**
 * A 401: the session cookie is missing or has expired. Every API call rejects with this one
 * type, so the app can treat "signed out" in one place (app/query-client.ts) instead of per
 * feature. The message is what a failed action shows next to its button.
 */
export class SignedOutError extends ApiRequestError {
  override readonly name: string = 'SignedOutError';

  constructor(path: string, body: unknown, method: string) {
    super(401, path, body);
    this.message =
      method === 'GET'
        ? 'Your session has expired. Sign in again to continue.'
        : 'Not saved: your session has expired. Sign in again, then retry.';
  }
}

/** True for the signed-out outcome of any API call. */
export function isSignedOut(error: unknown): error is SignedOutError {
  return error instanceof SignedOutError;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * The only `fetch` in the web app (ESLint `no-restricted-globals` outside api-client/). The
 * session cookie rides along because every call is same-origin.
 */
async function request(path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(new URL(path, globalThis.location.href), {
    ...init,
    credentials: 'same-origin',
  });
  const body = await readBody(response);
  if (response.status === 401) throw new SignedOutError(path, body, init.method ?? 'GET');
  if (!response.ok) throw new ApiRequestError(response.status, path, body);
  return body;
}

/** `GET` a JSON resource and validate it against its shared zod contract from @targus/core. */
export async function getJson<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
): Promise<z.output<Schema>> {
  const body = await request(path, { headers: { accept: 'application/json' } });
  return schema.parse(body);
}

/** `POST` an optional JSON body; the response is validated when a schema is given. */
export async function postJson<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  body?: unknown,
): Promise<z.output<Schema>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const init: RequestInit = { method: 'POST', headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return schema.parse(await request(path, init));
}
