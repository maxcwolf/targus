import type { APIRequestContext } from '@playwright/test';
import { z } from 'zod';

import { e2eConfig } from '../config.ts';
import type { RecordedCheckRun } from './github-stub.ts';

// Control helpers for the GitHub stub (support/github-stub.ts) a spec drives.

const stubUrl = `http://127.0.0.1:${e2eConfig.githubStubPort}`;

const CheckRuns = z.array(
  z.object({
    method: z.enum(['POST', 'PATCH']),
    repo: z.string(),
    checkRunId: z.number().nullable(),
    body: z.record(z.string(), z.unknown()),
  }),
);

/** Who the next "Sign in with GitHub" signs in as: `octocat` (an org member) or `outsider`. */
export async function signInNextAs(
  request: APIRequestContext,
  login: 'octocat' | 'outsider',
): Promise<void> {
  const response = await request.post(`${stubUrl}/__next-login`, { data: { login } });
  if (!response.ok()) throw new Error(`stub answered ${response.status()}`);
}

/** Every check-run request the stub received for `repo`, oldest first. */
export async function checkRunsFor(
  request: APIRequestContext,
  repo: string,
): Promise<RecordedCheckRun[]> {
  const response = await request.get(`${stubUrl}/__check-runs`, { params: { repo } });
  return CheckRuns.parse(await response.json());
}
