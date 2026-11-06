import { randomUUID } from 'node:crypto';

import type { IdGenerator } from '@targus/core';

/** `IdGenerator` backed by Node's `crypto.randomUUID`: a v4 UUID per call. */
export const cryptoIdGenerator: IdGenerator = { next: () => randomUUID() };
