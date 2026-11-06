import { describe, expect, it } from 'vitest';

import type { MembershipRepository } from '../../../src/repositories/membership.repository.ts';

/** A membership cache, D1's or the double's, and how to make the user and org it caches. */
export interface MembershipHarness {
  readonly repository: MembershipRepository;
  /** Make user `userId` and org `orgId` exist; each id is new per call. */
  readonly seed: (userId: string, orgId: string) => Promise<void>;
}

type Harness = () => MembershipHarness;

const at = new Date('2026-01-01T00:00:00.000Z');
const hourLater = new Date(at.getTime() + 3_600_000);

async function replacesOnSet({ repository, seed }: MembershipHarness): Promise<void> {
  await seed('mc-user-1', 'mc-org-1');

  expect(await repository.get('mc-user-1', 'mc-org-1')).toBeNull();
  await repository.set('mc-user-1', 'mc-org-1', true, at);
  expect(await repository.get('mc-user-1', 'mc-org-1')).toEqual({ member: true, checkedAt: at });

  await repository.set('mc-user-1', 'mc-org-1', false, hourLater);
  expect(await repository.get('mc-user-1', 'mc-org-1')).toEqual({
    member: false,
    checkedAt: hourLater,
  });
}

async function onePerUserAndOrg({ repository, seed }: MembershipHarness): Promise<void> {
  await seed('mc-user-2', 'mc-org-2');
  await seed('mc-user-3', 'mc-org-3');
  await repository.set('mc-user-2', 'mc-org-2', true, at);
  await repository.set('mc-user-2', 'mc-org-3', false, hourLater);

  expect(await repository.get('mc-user-2', 'mc-org-2')).toEqual({ member: true, checkedAt: at });
  expect(await repository.get('mc-user-2', 'mc-org-3')).toEqual({
    member: false,
    checkedAt: hourLater,
  });
  expect(await repository.get('mc-user-3', 'mc-org-2')).toBeNull();
}

/** The contract of `MembershipRepository`, for the D1 adapter and the in-memory double. */
export function describeMembershipContract(name: string, harness: Harness): void {
  describe(`${name} membership cache`, () => {
    it('caches one answer per user and org, replacing it on set', () => replacesOnSet(harness()));
    it('keeps the answers of different users and orgs apart', () => onePerUserAndOrg(harness()));
  });
}
