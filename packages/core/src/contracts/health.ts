import { z } from 'zod';

/** `GET /api/health` response. */
export const HealthResponse = z.object({
  ok: z.boolean(),
  version: z.string().min(1),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
