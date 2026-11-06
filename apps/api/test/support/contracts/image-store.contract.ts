import type { ImageStore } from '@targus/core';
import { describe, expect, it } from 'vitest';

/** An `ImageStore`, R2's or the double's, and how to record a hash in its metadata table. */
export interface ImageStoreHarness {
  readonly store: ImageStore;
  readonly record: (hash: string) => Promise<void>;
}

type Harness = () => ImageStoreHarness;

/** A distinct 64-character hash per tag. */
const tagged = (tag: string): string => tag.padEnd(64, '0');

async function roundTrips({ store }: ImageStoreHarness): Promise<void> {
  const bytes = new Uint8Array([1, 2, 3]);

  await store.put(tagged('isc-a'), bytes);

  expect(await store.get(tagged('isc-a'))).toEqual(new Uint8Array([1, 2, 3]));
  expect(await store.get(tagged('isc-none'))).toBeNull();
}

async function keepsFirstBytes({ store }: ImageStoreHarness): Promise<void> {
  await store.put(tagged('isc-b'), new Uint8Array([1]));
  await store.put(tagged('isc-b'), new Uint8Array([2]));

  expect(await store.get(tagged('isc-b'))).toEqual(new Uint8Array([1]));
}

async function holdsItsOwnCopy({ store }: ImageStoreHarness): Promise<void> {
  const bytes = new Uint8Array([1, 2]);
  await store.put(tagged('isc-c'), bytes);
  bytes.fill(9);
  const read = await store.get(tagged('isc-c'));
  read?.fill(8);

  expect(await store.get(tagged('isc-c'))).toEqual(new Uint8Array([1, 2]));
}

async function missingFromMetadata({ store, record }: ImageStoreHarness): Promise<void> {
  const [stored, recorded] = [tagged('isc-d'), tagged('isc-e')];
  await store.put(stored, new Uint8Array([1]));
  await record(recorded);

  expect(await store.missing([stored, recorded])).toEqual([stored]);
}

/** The contract of the `ImageStore` port, for the R2 adapter and the in-memory double. */
export function describeImageStoreContract(name: string, harness: Harness): void {
  describe(`${name} image store`, () => {
    it('stores bytes under the hash and reads them back', () => roundTrips(harness()));
    it('is idempotent: a second put of the same hash keeps the first bytes', () =>
      keepsFirstBytes(harness()));
    it("is not changed by writes to the caller's buffers", () => holdsItsOwnCopy(harness()));
    it('answers missing() from the metadata table, not from the stored bytes', () =>
      missingFromMetadata(harness()));
  });
}
