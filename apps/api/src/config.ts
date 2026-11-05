import { z } from 'zod';

import type { Bindings } from './bindings.js';

// Workers have no process.env: configuration arrives as bindings and is validated here, the
// only place that reads raw variables.
const VarsSchema = z.object({
  APP_VERSION: z.string().min(1),
});

export interface ApiConfig {
  readonly version: string;
}

export function loadConfig(bindings: Pick<Bindings, 'APP_VERSION'>): ApiConfig {
  const vars = VarsSchema.parse(bindings);
  return { version: vars.APP_VERSION };
}
