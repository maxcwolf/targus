import { TargusError } from '@targus/core';
import type { Context } from 'hono';
import { z } from 'zod';

/** Parse the request body as JSON and validate it with a core contract, else `bad_request`. */
export async function jsonBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new TargusError('bad_request', 'request body is not valid JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new TargusError('bad_request', z.prettifyError(parsed.error));
  return parsed.data;
}
