import path from 'node:path';

import type { APIRequestContext } from '@playwright/test';
import { writeFixtureCapture } from '@targus/cli';

import { e2eConfig } from '../config.ts';
import { createProject } from './api.ts';
import { targusRun, type Checkout } from './cli.ts';

// The two builds of the review flow, published by the CLI from fixture captures: review.spec.ts
// reviews them in the browser (from this repo) and local.ts seeds `yarn dev:local` with them
// (from a throwaway repository, support/seed-repo.ts).

export interface Published {
  readonly repo: string;
  readonly token: string;
  readonly apiUrl: string;
  readonly mainBuildId: string;
  /** Holds the `base` and `changed` fixture captures. */
  readonly dir: string;
  /** The git checkout `targus run` publishes from, and its two commits. */
  readonly checkout: Checkout;
}

const cliFlags = (apiUrl: string) => ['--device-name', 'e2e', '--api-url', apiUrl];

/** Where a project's builds go and where they come from. */
export interface PublishTarget {
  readonly apiUrl: string;
  /** The project's `owner/name`; the owner is its GitHub org. */
  readonly repo: string;
  /** Directory for the fixture captures. */
  readonly dir: string;
  readonly checkout: Checkout;
}

/**
 * Create a project for `repo` with the e2e installation (so check runs and membership go to the
 * GitHub stub), write both fixture captures under `dir`, and publish a main build (all three
 * stories new) on the checkout's `mainSha`, where it is the baseline of a later PR build once
 * accepted.
 */
export async function publishMainBuild(
  request: APIRequestContext,
  target: PublishTarget,
): Promise<Published> {
  const { apiUrl, repo, dir, checkout } = target;
  const token = await createProject(request, repo, e2eConfig.installationId);
  await writeFixtureCapture(path.join(dir, 'base'), 'base');
  await writeFixtureCapture(path.join(dir, 'changed'), 'changed');
  const main = await targusRun(
    token,
    [
      ...cliFlags(apiUrl),
      '--from-capture',
      path.join(dir, 'base'),
      '--branch',
      'main',
      '--sha',
      checkout.mainSha,
    ],
    checkout.dir,
  );
  return { repo, token, apiUrl, mainBuildId: main.buildId, dir, checkout };
}

/** Publish a PR build on the checkout's HEAD in which one story (Fixture/Solid : Red) changed. */
export async function publishPrBuild(published: Published): Promise<string> {
  const pr = await targusRun(
    published.token,
    [
      ...cliFlags(published.apiUrl),
      '--from-capture',
      path.join(published.dir, 'changed'),
      '--branch',
      'feature/e2e',
      '--pr',
      '7',
      '--sha',
      published.checkout.headSha,
    ],
    published.checkout.dir,
  );
  return pr.buildId;
}
