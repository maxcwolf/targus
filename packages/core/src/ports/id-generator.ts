/**
 * The only source of new ids. Production code never calls `crypto.randomUUID()` or
 * `Math.random()` directly (ESLint `no-restricted-syntax`); adapters implement this port and
 * tests use `createFakeIdGenerator` from `id-generator.fake.ts`.
 */
export interface IdGenerator {
  next(): string;
}
