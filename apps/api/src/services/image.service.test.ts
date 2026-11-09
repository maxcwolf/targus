import { describe, expect, it } from 'vitest';

import { imageHash, newProject } from '../../test/support/fixtures.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { signInReviewer } from '../../test/support/in-memory-auth.ts';
import { createTestDeps, type TestDeps } from '../../test/support/in-memory.ts';
import { pngFixture } from '../../test/support/png.ts';
import type { Project } from '../ports/project-repository.ts';
import { getImage, uploadImage } from './image.service.ts';
import type { Principal, Reviewer } from './principal.ts';

/** Test deps with two projects of different orgs: `uploader` and `otherTenant`. */
async function setup(deps: TestDeps = createTestDeps()) {
  const uploader = await deps.projects.create(newProject('img'));
  const otherTenant = await deps.projects.create(newProject('elsewhere'));
  const anyProject: Principal = { kind: 'project', project: uploader };
  return { deps, uploader, otherTenant, anyProject };
}

function asReviewer(reviewer: Reviewer): Principal {
  return { kind: 'reviewer', reviewer };
}

describe('uploadImage', () => {
  it('stores a PNG under its hash and records its size and dimensions', async () => {
    const { deps, uploader, anyProject } = await setup();
    const png = await pngFixture(3, 2, 10);

    expect(await uploadImage(deps, uploader, png.hash, png.bytes)).toEqual({
      hash: png.hash,
      stored: true,
    });
    expect(deps.images.records.get(png.hash)).toEqual({
      hash: png.hash,
      sizeBytes: png.bytes.length,
      width: 3,
      height: 2,
      lastReferencedAt: deps.clock.now(),
    });
    expect(await getImage(deps, anyProject, png.hash)).toEqual(png.bytes);
  });

  it('is idempotent and touches an image it already has', async () => {
    const { deps, uploader } = await setup();
    const png = await pngFixture(1, 1, 20);
    await uploadImage(deps, uploader, png.hash, png.bytes);
    deps.clock.advance(1000);

    expect(await uploadImage(deps, uploader, png.hash, png.bytes)).toEqual({
      hash: png.hash,
      stored: false,
    });
    expect(deps.images.records.get(png.hash)?.lastReferencedAt).toEqual(deps.clock.now());
  });

  it('rejects a body whose sha256 is not the path hash', async () => {
    const { deps, uploader } = await setup();
    const png = await pngFixture(1, 1, 30);

    await expect(uploadImage(deps, uploader, imageHash('a'), png.bytes)).rejects.toThrow(
      'body sha256 does not match the path hash',
    );
  });

  it('rejects bodies that are not PNGs and malformed hashes', async () => {
    const { deps, uploader } = await setup();
    const png = await pngFixture(1, 1, 40);

    await expect(uploadImage(deps, uploader, imageHash('a'), new Uint8Array(40))).rejects.toThrow(
      'body is not a PNG',
    );
    await expect(uploadImage(deps, uploader, 'NOT-A-HASH', png.bytes)).rejects.toMatchObject({
      code: 'bad_request',
    });
  });
});

describe('getImage', () => {
  it('answers not_found for an unknown hash', async () => {
    const { deps, anyProject } = await setup();
    await expect(getImage(deps, anyProject, imageHash('f'))).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('getImage for project tokens', () => {
  it('hides an image from a project that did not upload it, exactly like a missing one', async () => {
    const { deps, uploader, otherTenant, anyProject } = await setup();
    const png = await pngFixture(2, 2, 45);
    await uploadImage(deps, uploader, png.hash, png.bytes);
    const stranger: Principal = { kind: 'project', project: otherTenant };

    await expect(getImage(deps, stranger, png.hash)).rejects.toMatchObject({
      code: 'not_found',
      message: `no image ${png.hash}`,
    });
    expect(await getImage(deps, anyProject, png.hash)).toEqual(png.bytes);
  });

  it('serves it once that project has sent the same bytes itself', async () => {
    const { deps, uploader, otherTenant } = await setup();
    const png = await pngFixture(2, 2, 46);
    await uploadImage(deps, uploader, png.hash, png.bytes);

    expect(await uploadImage(deps, otherTenant, png.hash, png.bytes)).toEqual({
      hash: png.hash,
      stored: false,
    });
    expect(await getImage(deps, { kind: 'project', project: otherTenant }, png.hash)).toEqual(
      png.bytes,
    );
  });

  it('does not count a rejected upload', async () => {
    const { deps, uploader, otherTenant } = await setup();
    const png = await pngFixture(2, 2, 47);
    await uploadImage(deps, uploader, png.hash, png.bytes);
    const forged = await pngFixture(2, 2, 48);

    await expect(uploadImage(deps, otherTenant, png.hash, forged.bytes)).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect(deps.images.uploads.get(otherTenant.id)).toBeUndefined();
  });
});

describe('getImage for reviewers', () => {
  it('serves an image a project of the reviewer org uploaded and hides every other as not_found', async () => {
    const deps = createTestDeps({ github: createRecordingGitHub(['octocat']) });
    const mine = await deps.projects.create(newProject('img-mine', { installationId: 1 }));
    const theirs = await deps.projects.create(newProject('img-theirs'));
    const png = await pngFixture(2, 2, 50);
    const other = await pngFixture(2, 2, 60);
    for (const project of [theirs, mine]) {
      await uploadImage(deps, project, png.hash, png.bytes);
    }
    await uploadImage(deps, theirs, other.hash, other.bytes);
    const member = asReviewer(await signInReviewer(deps, 'octocat'));
    const outsider = asReviewer(await signInReviewer(deps, 'outsider'));

    expect(await getImage(deps, member, png.hash)).toEqual(png.bytes);
    for (const [principal, hash] of [
      [member, other.hash],
      [outsider, png.hash],
      [member, imageHash('0')],
    ] as const) {
      await expect(getImage(deps, principal, hash)).rejects.toMatchObject({ code: 'not_found' });
    }
  });
});

describe('getImage for reviewers with many projects', () => {
  it('finds the reviewer org among more than 20 orgs that uploaded the image', async () => {
    const github = createRecordingGitHub({ 'org-many-mine': ['octocat'] });
    const deps = createTestDeps({ github });
    const png = await pngFixture(2, 2, 51);
    for (let index = 0; index < 25; index += 1) {
      const project = await deps.projects.create(
        newProject(`many-${index}`, { installationId: 100 + index }),
      );
      await uploadImage(deps, project, png.hash, png.bytes);
    }
    const mine = await deps.projects.create(newProject('many-mine', { installationId: 1 }));
    await uploadImage(deps, mine, png.hash, png.bytes);

    expect(
      await getImage(deps, asReviewer(await signInReviewer(deps, 'octocat')), png.hash),
    ).toEqual(png.bytes);
  });

  it('serves an image of the 25th project of an org with more than 20', async () => {
    const deps = createTestDeps({ github: createRecordingGitHub(['octocat']) });
    const png = await pngFixture(2, 2, 52);
    let last: Project | null = null;
    for (let index = 0; index < 25; index += 1) {
      last = await deps.projects.create(
        newProject(`wide-${index}`, { githubOrg: 'wide', newOrgId: 'org-wide', installationId: 1 }),
      );
    }
    if (last === null) throw new Error('no project');
    await uploadImage(deps, last, png.hash, png.bytes);

    expect(
      await getImage(deps, asReviewer(await signInReviewer(deps, 'octocat')), png.hash),
    ).toEqual(png.bytes);
  });
});

describe('getImage for reviewers and the membership cache', () => {
  it('decides from a cached membership first and asks GitHub nothing', async () => {
    const github = createRecordingGitHub(['octocat']);
    const deps = createTestDeps({ github });
    const theirs = await deps.projects.create(newProject('cache-theirs', { installationId: 2 }));
    const mine = await deps.projects.create(newProject('cache-mine', { installationId: 1 }));
    const png = await pngFixture(2, 2, 53);
    await uploadImage(deps, theirs, png.hash, png.bytes);
    await uploadImage(deps, mine, png.hash, png.bytes);
    const reviewer = await signInReviewer(deps, 'octocat');
    await deps.memberships.set(reviewer.user.id, mine.orgId, true, deps.clock.now());

    expect(await getImage(deps, asReviewer(reviewer), png.hash)).toEqual(png.bytes);
    expect(github.membershipChecks).toEqual([]);
  });

  it('asks GitHub again once the cached membership is an hour old', async () => {
    const github = createRecordingGitHub([]);
    const deps = createTestDeps({ github });
    const mine = await deps.projects.create(newProject('stale', { installationId: 1 }));
    const png = await pngFixture(2, 2, 54);
    await uploadImage(deps, mine, png.hash, png.bytes);
    const reviewer = await signInReviewer(deps, 'octocat');
    await deps.memberships.set(reviewer.user.id, mine.orgId, true, deps.clock.now());
    deps.clock.advance(60 * 60 * 1000);

    await expect(getImage(deps, asReviewer(reviewer), png.hash)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(github.membershipChecks).toEqual([{ org: 'org-stale', login: 'octocat' }]);
  });
});
