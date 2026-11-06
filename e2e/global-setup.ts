import { e2eConfig } from './config.ts';
import { startGitHubStub } from './support/github-stub.ts';

/**
 * Start the GitHub stub the Worker talks to (see playwright.config.ts). Playwright keeps this
 * process alive for the whole run; the returned function stops the stub afterwards.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const server = await startGitHubStub(e2eConfig.githubStubPort);
  return () =>
    new Promise((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
}
