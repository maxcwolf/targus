import { describe, expect, it } from 'vitest';

import { imageHash, newProject } from '../../test/support/fixtures.js';
import { createRecordingGitHub } from '../../test/support/github-recorder.js';
import { signInReviewer } from '../../test/support/in-memory-auth.js';
import { createTestDeps } from '../../test/support/in-memory.js';
import { pngFixture } from '../../test/support/png.js';
import { getImage, uploadImage } from './image.service.js';
import type { Principal } from './principal.js';

const anyProject: Principal = {
  kind: 'project',
  project: {
    id: 'project-img',
    orgId: 'org-img',
    repo: 'org-img/app',
    name: 'img',
    defaultBranch: 'main',
    createdAt: new Date(0),
    org: { githubOrg: 'org-img', installationId: null },
  },
};

describe('uploadImage', () => {
  it('stores a PNG under its hash and records its size and dimensions', async () => {
    const deps = createTestDeps();
    const png = await pngFixture(3, 2, 10);

    expect(await uploadImage(deps, png.hash, png.bytes)).toEqual({ hash: png.hash, stored: true });
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
    const deps = createTestDeps();
    const png = await pngFixture(1, 1, 20);
    await uploadImage(deps, png.hash, png.bytes);
    deps.clock.advance(1000);

    expect(await uploadImage(deps, png.hash, png.bytes)).toEqual({ hash: png.hash, stored: false });
    expect(deps.images.records.get(png.hash)?.lastReferencedAt).toEqual(deps.clock.now());
  });

  it('rejects a body whose sha256 is not the path hash', async () => {
    const png = await pngFixture(1, 1, 30);

    await expect(uploadImage(createTestDeps(), imageHash('a'), png.bytes)).rejects.toThrow(
      'body sha256 does not match the path hash',
    );
  });

  it('rejects bodies that are not PNGs and malformed hashes', async () => {
    const deps = createTestDeps();
    const png = await pngFixture(1, 1, 40);

    await expect(uploadImage(deps, imageHash('a'), new Uint8Array(40))).rejects.toThrow(
      'body is not a PNG',
    );
    await expect(uploadImage(deps, 'NOT-A-HASH', png.bytes)).rejects.toMatchObject({
      code: 'bad_request',
    });
  });
});

describe('getImage', () => {
  it('answers not_found for an unknown hash', async () => {
    await expect(getImage(createTestDeps(), anyProject, imageHash('f'))).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('getImage for reviewers', () => {
  it('serves an image of a project in the reviewer org and hides every other as not_found', async () => {
    const deps = createTestDeps({ github: createRecordingGitHub(['octocat']) });
    const mine = await deps.projects.create(newProject('img-mine', { installationId: 1 }));
    const theirs = await deps.projects.create(newProject('img-theirs'));
    const png = await pngFixture(2, 2, 50);
    const other = await pngFixture(2, 2, 60);
    await uploadImage(deps, png.hash, png.bytes);
    await uploadImage(deps, other.hash, other.bytes);
    deps.images.references.set(png.hash, ['project-gone', theirs.id, mine.id]);
    deps.images.references.set(other.hash, [theirs.id]);
    const member = { kind: 'reviewer', reviewer: await signInReviewer(deps, 'octocat') } as const;
    const outsider = {
      kind: 'reviewer',
      reviewer: await signInReviewer(deps, 'outsider'),
    } as const;

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
