import type { IdGenerator } from '@targus/core';

/** `IdGenerator` backed by `crypto.randomUUID`. */
export const cryptoIdGenerator: IdGenerator = { next: () => crypto.randomUUID() };
