import { describe, expect, it } from 'vitest';

import type { ImageRecord, ImageRepository } from '../../../src/repositories/image.repository.ts';
import type { MembershipRepository } from '../../../src/repositories/membership.repository.ts';
import type { ProjectRepository } from '../../../src/repositories/project.repository.ts';
import type { UserRepository } from '../../../src/repositories/user.repository.ts';
import { isForeignKeyViolation } from '../d1-semantics.ts';
import { newProject } from '../fixtures.ts';

/**
 * An images repository, D1's or the double's, with the projects, users and membership cache
 * its `uploaderOrgs` reads, all of the same kind.
 */
export interface ImageHarness {
  readonly images: ImageRepository;
  readonly projects: ProjectRepository;
  readonly users: UserRepository;
  readonly memberships: MembershipRepository;
  /** The stored row of `hash`, or null: what `record` and `touch` left. */
  readonly stored: (hash: string) => Promise<(ImageRecord & { lastReferencedAt: Date }) | null>;
}

type Harness = () => ImageHarness;

const at = new Date('2026-01-01T00:00:00.000Z');
const after = (ms: number) => new Date(at.getTime() + ms);

/** A distinct 64-character hash per tag. */
const tagged = (tag: string): string => tag.padEnd(64, '0');

/** `count` distinct hashes, more than D1 binds parameters when `count` is over 100. */
const many = (tag: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => tagged(`${tag}-${String(index)}`));

const image = (hash: string, sizeBytes = 10): ImageRecord => ({
  hash,
  sizeBytes,
  width: 1,
  height: 2,
});

async function reportsMissing({ images }: ImageHarness): Promise<void> {
  const [a, b, c] = [tagged('ic-miss-a'), tagged('ic-miss-b'), tagged('ic-miss-c')];
  await images.record(image(a), at);

  expect(await images.missing([b, a, c, b])).toEqual([b, c, b]);
  expect(await images.missing([])).toEqual([]);
  const hashes = many('ic-miss-many', 150);
  await images.record(image(hashes[0] ?? ''), at);
  expect(await images.missing(hashes)).toEqual(hashes.slice(1));
}

async function keepsFirstRecord({ images, stored }: ImageHarness): Promise<void> {
  const [hash, absent] = [tagged('ic-rec-d'), tagged('ic-rec-e')];
  await images.record(image(hash), at);
  await images.record({ hash, sizeBytes: 99, width: 9, height: 9 }, after(5));
  expect(await stored(hash)).toEqual({ ...image(hash), lastReferencedAt: at });

  await images.touch([hash, absent], after(1000));
  await images.touch([], after(2000));

  expect(await stored(hash)).toEqual({ ...image(hash), lastReferencedAt: after(1000) });
  expect(await stored(absent)).toBeNull();
  expect(await images.missing([absent])).toEqual([absent]);
}

async function remembersUploads({ images, projects }: ImageHarness): Promise<void> {
  const a = await projects.create(newProject('ic-up-a'));
  const b = await projects.create(newProject('ic-up-b'));
  const [one, two, three] = [tagged('ic-up-1'), tagged('ic-up-2'), tagged('ic-up-3')];
  await images.recordUpload(a.id, one, at);
  await images.recordUpload(a.id, one, after(5));
  await images.recordUpload(b.id, two, at);

  expect(await images.notUploadedBy(a.id, [three, one, two])).toEqual([three, two]);
  expect(await images.notUploadedBy(b.id, [three, one, two])).toEqual([three, one]);
  expect(await images.notUploadedBy(a.id, [])).toEqual([]);
  // An upload says nothing about the shared metadata table.
  expect(await images.missing([one])).toEqual([one]);
}

async function rejectsUploadOfMissingProject({ images }: ImageHarness): Promise<void> {
  const hash = tagged('ic-up-orphan');

  await expect(images.recordUpload('project-ic-none', hash, at)).rejects.toSatisfy(
    isForeignKeyViolation,
  );

  expect(await images.notUploadedBy('project-ic-none', [hash])).toEqual([hash]);
  expect(await images.uploaderOrgs(hash, 'ic-nobody')).toEqual([]);
}

async function uploadsBeyondParameterLimit({ images, projects }: ImageHarness): Promise<void> {
  const project = await projects.create(newProject('ic-up-many'));
  const hashes = many('ic-up-many', 150);
  await images.recordUpload(project.id, hashes[0] ?? '', at);

  expect(await images.notUploadedBy(project.id, hashes)).toEqual(hashes.slice(1));
}

/** A project `key` in org `org`, which the first project naming it creates. */
function inOrg(key: string, org: string, installationId: number | null = null) {
  return newProject(key, { githubOrg: org, newOrgId: org, installationId });
}

async function listsUploaderOrgs(harness: ImageHarness): Promise<void> {
  const { images, projects, users, memberships } = harness;
  const [x1, x2, y, z] = [
    await projects.create(inOrg('ic-uo-x1', 'ic-uo-x', 7)),
    await projects.create(inOrg('ic-uo-x2', 'ic-uo-x')),
    await projects.create(inOrg('ic-uo-y', 'ic-uo-y')),
    await projects.create(inOrg('ic-uo-z', 'ic-uo-z')),
  ];
  await projects.setOrgAccountId('ic-uo-x', 7, 6007);
  const avatarUrl = 'https://avatars.test/9301';
  await users.upsertByGithubId({ id: 'ic-user', githubId: 9301, login: 'oc', avatarUrl, now: at });
  await memberships.set('ic-user', 'ic-uo-x', true, at);
  const [hash, unrelated] = [tagged('ic-uo-a1'), tagged('ic-uo-a2')];
  for (const project of [x1, x2, y]) await images.recordUpload(project.id, hash, at);
  await images.recordUpload(z.id, unrelated, at);

  // In no particular order, as the D1 query has none.
  const found = await images.uploaderOrgs(hash, 'ic-user');
  expect([...found].sort((a, b) => a.orgId.localeCompare(b.orgId))).toEqual([
    {
      orgId: 'ic-uo-x',
      githubOrg: 'ic-uo-x',
      installationId: 7,
      githubAccountId: 6007,
      membership: { member: true, checkedAt: at },
    },
    {
      orgId: 'ic-uo-y',
      githubOrg: 'ic-uo-y',
      installationId: null,
      githubAccountId: null,
      membership: null,
    },
  ]);
  expect(await images.uploaderOrgs(hash, 'ic-nobody')).toHaveLength(2);
  expect(await images.uploaderOrgs(tagged('ic-uo-a3'), 'ic-user')).toEqual([]);
}

async function uploaderOrgsAreCurrent({ images, projects }: ImageHarness): Promise<void> {
  const first = await projects.create(inOrg('ic-cur-1', 'ic-cur'));
  const hash = tagged('ic-cur');
  await images.recordUpload(first.id, hash, at);
  await projects.create(inOrg('ic-cur-2', 'ic-cur', 31));

  expect(await images.uploaderOrgs(hash, 'ic-nobody')).toMatchObject([
    { installationId: 31, githubAccountId: null },
  ]);
  await projects.setOrgAccountId(first.orgId, 31, 6031);
  expect(await images.uploaderOrgs(hash, 'ic-nobody')).toMatchObject([
    { installationId: 31, githubAccountId: 6031 },
  ]);
}

async function noCapOnOrgs({ images, projects }: ImageHarness): Promise<void> {
  const hash = tagged('ic-cap');
  for (let index = 0; index < 25; index += 1) {
    const project = await projects.create(inOrg(`ic-cap-${index}`, `ic-cap-${index}`));
    await images.recordUpload(project.id, hash, at);
  }

  expect(await images.uploaderOrgs(hash, 'ic-nobody')).toHaveLength(25);
}

/** The contract of `ImageRepository`, for the D1 adapter and the in-memory double. */
export function describeImageContract(name: string, harness: Harness): void {
  describe(`${name} image metadata`, () => {
    it('reports unrecorded hashes in input order, for any number of them', () =>
      reportsMissing(harness()));
    it('keeps the first record and bumps last_referenced_at of existing rows on touch', () =>
      keepsFirstRecord(harness()));
  });

  describe(`${name} image uploads`, () => {
    it('remembers uploads per project, once, and answers in input order', () =>
      remembersUploads(harness()));
    it('rejects an upload by a project that does not exist, storing nothing', () =>
      rejectsUploadOfMissingProject(harness()));
    it('answers for more hashes than D1 binds parameters', () =>
      uploadsBeyondParameterLimit(harness()));
    it('lists each org that uploaded a hash once, with the user cached membership', () =>
      listsUploaderOrgs(harness()));
    it("gives each org's current installation and account id", () =>
      uploaderOrgsAreCurrent(harness()));
    it('has no cap on the number of orgs', () => noCapOnOrgs(harness()));
  });
}
