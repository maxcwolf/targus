import { CreateInstallationProjectRequest, InstallationId, TargusError } from '@targus/core';
import { Hono } from 'hono';

import type { AppEnv } from '../app-env.ts';
import { sessionAuth } from '../middleware/auth.ts';
import { jsonBody } from '../middleware/json-body.ts';

/** The `:id` of the path as an installation id; anything else is `not_found`. */
function installationId(param: string): number {
  const id = InstallationId.safeParse(param);
  if (!id.success) throw new TargusError('not_found', `no installation ${param}`);
  return id.data;
}

/**
 * `/api/installations/*`: how a reviewer makes a project without an admin (ADR 0049). They list
 * the GitHub App installations they can use, the repositories one can see, and make a project
 * for one of those. All behind the session; an installation on an account the reviewer does not
 * belong to answers 403.
 */
export const installationsRoute = new Hono<AppEnv>()
  .get('/', sessionAuth, async (c) =>
    c.json(await c.var.services.listInstallations(c.var.reviewer)),
  )
  .get('/:id/repos', sessionAuth, async (c) => {
    const { services, reviewer } = c.var;
    return c.json(
      await services.listInstallationRepos(reviewer, installationId(c.req.param('id'))),
    );
  })
  .post('/:id/projects', sessionAuth, async (c) => {
    const request = await jsonBody(c, CreateInstallationProjectRequest);
    const { services, reviewer } = c.var;
    const id = installationId(c.req.param('id'));
    return c.json(await services.createInstallationProject(reviewer, id, request), 201);
  });
