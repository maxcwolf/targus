import { mkdir } from 'node:fs/promises';
import type { Server } from 'node:http';
import path from 'node:path';

import { request as playwrightRequest } from '@playwright/test';

import { e2eConfig, localConfigFrom } from './config.ts';
import { approveAll, signInThroughStub } from './support/api.ts';
import { publishMainBuild, publishPrBuild, type Published } from './support/builds.ts';
import { repoRoot } from './support/cli.ts';
import { startGitHubStub, stopGitHubStub } from './support/github-stub.ts';
import { createSeedCheckout } from './support/seed-repo.ts';
import { workerDevCommand, workerSetupCommands, type LocalWorker } from './support/local-worker.ts';
import { assertPortFree, runStep, startService, stopAll, waitForOk } from './support/processes.ts';

// `yarn dev:local`: the review UI on this machine with no GitHub account, App or secret. It
// starts the GitHub stub and a local Worker pointed at it (fresh local D1 and R2), publishes an
// accepted baseline and a PR build with one changed story, prints how to sign in, and stops
// everything on Ctrl-C. The `dev:local` script builds the CLI first; `targus run` publishes.

const localConfig = localConfigFrom(process.argv.slice(2));
// One directory per port, so two copies (or this and its test) never share state.
const baseDir = path.join(import.meta.dirname, '.wrangler', `local-${localConfig.port}`);
const apiUrl = `http://127.0.0.1:${localConfig.port}`;
const stubUrl = `http://127.0.0.1:${localConfig.githubStubPort}`;
const worker: LocalWorker = {
  port: localConfig.port,
  githubStubPort: localConfig.githubStubPort,
  publicUrl: localConfig.publicUrl,
  persistTo: path.join(baseDir, 'state'),
  webOutDir: path.join(baseDir, 'web'),
};

interface Seeded extends Published {
  readonly prBuildId: string;
}

/** The demo project: main build accepted by octocat (the baseline), then a PR build to review. */
async function seed(): Promise<Seeded> {
  const request = await playwrightRequest.newContext({ baseURL: apiUrl });
  try {
    const published = await publishMainBuild(request, {
      apiUrl,
      repo: 'targus-local/demo',
      dir: path.join(baseDir, 'captures'),
      // Not this checkout, which may be shallow, lack `main`, or have no `.git` at all.
      checkout: await createSeedCheckout(path.join(baseDir, 'repo')),
    });
    await signInThroughStub(request);
    await approveAll(request, worker.publicUrl, published.mainBuildId);
    return { ...published, prBuildId: await publishPrBuild(published) };
  } finally {
    await request.dispose();
  }
}

function printReady(seeded: Seeded): void {
  const outsider = `curl -X POST ${stubUrl}/__next-login -d '{"login":"outsider"}'`;
  const lines = [
    '',
    'targus is running locally.',
    '',
    `  Open        ${worker.publicUrl}`,
    '  Sign in     "Sign in with GitHub" signs you in as octocat, a member of every org,',
    '              through the GitHub stub. No GitHub account is needed.',
    `  Data        project ${seeded.repo}: build ${seeded.mainBuildId} is the accepted baseline,`,
    `              build ${seeded.prBuildId} (PR #7) has one changed story to approve or deny.`,
    `  Outsider    ${outsider}`,
    '              then sign out and in again: you are signed in as a non-member and may not',
    '              review. Send "octocat" the same way to switch back.',
    `  CLI         TARGUS_TOKEN=${seeded.token} node packages/cli/dist/bin.js run \\`,
    `                --api-url ${apiUrl} --from-capture <dir>`,
    `  Admin API   Authorization: Bearer ${e2eConfig.adminToken}`,
    `  Worker log  ${path.relative(repoRoot, path.join(baseDir, 'worker.log'))}`,
    '',
    'Press Ctrl-C to stop. Every start begins from an empty database.',
  ];
  console.log(lines.join('\n'));
}

let stub: Server | null = null;
let stopping = false;

async function shutdown(code: number): Promise<never> {
  if (!stopping) {
    stopping = true;
    await stopAll();
    if (stub !== null) await stopGitHubStub(stub);
  }
  process.exit(code);
}

async function main(): Promise<void> {
  await assertPortFree(worker.port);
  await assertPortFree(worker.githubStubPort);
  stub = await startGitHubStub(worker.githubStubPort);
  for (const command of workerSetupCommands(worker)) await runStep(command);
  await mkdir(baseDir, { recursive: true });
  const service = startService(workerDevCommand(worker), path.join(baseDir, 'worker.log'));
  service.once('exit', (code) => {
    if (stopping) return;
    console.error(`the Worker exited (${String(code)}); see ${path.join(baseDir, 'worker.log')}`);
    void shutdown(1);
  });
  await waitForOk(`${apiUrl}/api/health`);
  printReady(await seed());
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown(0));
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  void shutdown(1);
});
