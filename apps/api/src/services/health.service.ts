import type { HealthResponse } from '@targus/core';

import type { ApiConfig } from '../config.ts';

/** The service behind `GET /api/health`. Grows a D1 ping once there is something to ping. */
export function getHealth(config: ApiConfig): HealthResponse {
  return { ok: true, version: config.version };
}
