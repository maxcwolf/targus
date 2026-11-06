// @ts-check
// yarn new:route <name>
// Creates apps/api/src/routes/<name>.ts (HTTP concerns only) with a test beside it.
import { pathToFileURL } from 'node:url';

import { requireKebab, runCli, toCamel, writeNewFiles } from './lib/scaffold.mjs';

/** @param {string} name */
function templates(name) {
  const route = `${toCamel(name)}Route`;
  const source = `import { TargusError } from '@targus/core';
import { Hono } from 'hono';

import type { AppEnv } from '../app-env.ts';
import { sessionAuth } from '../middleware/auth.ts';

/**
 * \`/api/${name}/*\`, behind the session.
 *
 * HTTP concerns only: parse the request with a contract from @targus/core (\`jsonBody(c, X)\` for
 * a body), call one method of \`c.var.services\`, and map its result with \`c.json(...)\`. Never
 * import a repository here. CLI routes use \`projectAuth\` and admin routes \`adminAuth\` instead.
 */
export const ${route} = new Hono<AppEnv>().get('/', sessionAuth, (c) => {
  // TODO: return c.json(await c.var.services.yourUseCase(c.var.reviewer));
  throw new TargusError('not_implemented', \`\${c.req.method} \${c.req.path} is not implemented yet\`);
});
`;
  const test = `import { describe, expect, it } from 'vitest';

import { call } from '../../test/support/api.ts';
import { signIn, withCookie } from '../../test/support/session.ts';

// These tests go through the full app, so they answer 404 until the route is mounted in app.ts.
describe('GET /api/${name}', () => {
  // TODO: replace with the route's real behaviour and parse the body with its contract.
  it('is not implemented yet', async () => {
    const { cookie } = await signIn('octocat');

    const response = await call('/api/${name}', { headers: withCookie(cookie) });

    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: { code: 'not_implemented' } });
  });

  it('answers 401 without a session', async () => {
    expect((await call('/api/${name}')).status).toBe(401);
  });
});
`;
  return { route, source, test };
}

/**
 * @param {string} name
 * @param {string} route
 */
function nextSteps(name, route) {
  return [
    'next:',
    `  1. mount it in apps/api/src/app.ts with app.route('/api/${name}', ${route});`,
    '     its test answers 404 until you do',
    '  2. add the request and response schemas to packages/core/src/contracts/',
    '  3. write the use-case in apps/api/src/services/, add it to Services and bindServices in',
    '     apps/api/src/services/index.ts, and call it from the route in place of the TargusError',
    '  4. add the endpoint to the route table in apps/api/README.md',
    '  5. replace the generated test with the real behaviour, then run yarn check',
  ];
}

/**
 * @param {string[]} args
 * @param {string} root
 * @returns {string}
 */
export function main(args, root) {
  if (args.length !== 1) throw new Error('usage: yarn new:route <name>');
  const name = requireKebab(args[0], 'name');
  const { route, source, test } = templates(name);
  const written = writeNewFiles(root, [
    { path: `apps/api/src/routes/${name}.ts`, content: source },
    { path: `apps/api/src/routes/${name}.test.ts`, content: test },
  ]);
  return [...written.map((file) => `created ${file}`), ...nextSteps(name, route)].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runCli(main);
