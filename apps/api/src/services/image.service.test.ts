import { describe, expect, it } from 'vitest';

import { imageHash, newProject } from '../../test/support/fixtures.js';
import { createRecordingGitHub } from '../../test/support/github-recorder.js';
import { signInReviewer } from '../../test/support/in-memory-auth.js';
import { createTestDeps } from '../../test/support/in-memory.js';
import { pngFixture } from '../../test/support/png.js';
import type { Project } from '../repositories/project.repository.js';
import { getImage, uploadImage } from './image.service.js';
import type { Principal } from './principal.js';

function projectOf(key: string): Project {
  return {
    id: `project-${key}`,
    orgId: `org-${key}`,
    repo: `org-${key}/app`,
    name: key,
    defaultBranch: 'main',
    createdAt: new Date(0),
    org: { githubOrg: `org-${key}`, installationId: null },
  };
}

const uploader = projectOf('img');
const anyProject: Principal = { kind: 'project', project: uploader };
const otherTenant = projectOf('elsewhere');

describe('uploadImage', () => {
  it('stores a PNG under its hash and records its size and dimensions', async () => {
    const deps = createTestDeps();
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
    const deps = createTestDeps();
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
    const png = await pngFixture(1, 1, 30);

    await expect(
      uploadImage(createTestDeps(), uploader, imageHash('a'), png.bytes),
    ).rejects.toThrow('body sha256 does not match the path hash');
  });

  it('rejects bodies that are not PNGs and malformed hashes', async () => {
    const deps = createTestDeps();
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
    await expect(getImage(createTestDeps(), anyProject, imageHash('f'))).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('getImage for project tokens', () => {
  it('hides an image from a project that did not upload it, exactly like a missing one', async () => {
    const deps = createTestDeps();
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
    const deps = createTestDeps();
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
    const deps = createTestDeps();
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
  it('serves an image of a project in the reviewer org and hides every other as not_found', async () => {
    const deps = createTestDeps({ github: createRecordingGitHub(['octocat']) });
    const mine = await deps.projects.create(newProject('img-mine', { installationId: 1 }));
    const theirs = await deps.projects.create(newProject('img-theirs'));
    const png = await pngFixture(2, 2, 50);
    const other = await pngFixture(2, 2, 60);
    await uploadImage(deps, uploader, png.hash, png.bytes);
    await uploadImage(deps, uploader, other.hash, other.bytes);
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
