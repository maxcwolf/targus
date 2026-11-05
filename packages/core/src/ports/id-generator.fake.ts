import type { IdGenerator } from './id-generator.js';

/** An `IdGenerator` that yields `<prefix>-1`, `<prefix>-2`, ... in order. */
export function createFakeIdGenerator(prefix = 'id'): IdGenerator {
  let counter = 0;

  return {
    next: () => {
      counter += 1;
      return `${prefix}-${counter}`;
    },
  };
}
