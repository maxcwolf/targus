import { HealthResponse } from '@targus/core';

import { getJson } from './http.js';

/** `GET /api/health`, validated with the shared `HealthResponse` contract. */
export function getHealth(): Promise<HealthResponse> {
  return getJson('/api/health', HealthResponse);
}
