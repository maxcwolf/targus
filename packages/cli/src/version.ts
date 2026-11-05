import { createRequire } from 'node:module';

import { z } from 'zod';

// src/version.ts and dist/version.js both sit one level below the package root.
const packageJson = z
  .object({ version: z.string().min(1) })
  .parse(createRequire(import.meta.url)('../package.json'));

export const cliVersion = packageJson.version;
