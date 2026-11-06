// @ts-check
// yarn new:route <name> [--no-register]
// Creates apps/api/src/routes/<name>.ts (HTTP concerns only) with a test beside it, and mounts
// it in apps/api/src/app.ts at /api/<name>.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { appFile, registerRoute, registrationLines } from './lib/register-route.mjs';
import { formatted, requireKebab, runCli, toCamel, wrap, writeNewFiles } from './lib/scaffold.mjs';

// What these templates take from how the API is composed: `AppEnv` from `../app-env.ts`,
// `sessionAuth`, `c.var.services` and `c.var.reviewer` in the route; `call`, `appWith`,
// `fakeObservability` and `signIn` from `test/support/` in the test.

/**
 * @param {string} name
 * @param {string} route
 */
function routeSource(name, route) {
  const doc = [
    `\`GET /api/${name}\`: TODO: say what it answers. Behind the session.\n\n`,
    'HTTP concerns only: parse the request with a contract from @targus/core (`jsonBody(c, X)`',
    'for a body), call one method of `c.var.services`, and map its result with `c.json(...)`.',
    'Never import a repository here. CLI routes use `projectAuth` and admin routes `adminAuth`.',
  ].join(' ');
  return `import { TargusError } from '@targus/core';
import { Hono } from 'hono';

import type { AppEnv } from '../app-env.ts';
import { sessionAuth } from '../middleware/auth.ts';

/**
${wrap(doc, ' * ')}
 */
export const ${route} = new Hono<AppEnv>().get('/', sessionAuth, (c) => {
  // TODO: return c.json(await c.var.services.yourUseCase(c.var.reviewer));
  throw new TargusError('not_implemented', \`\${c.req.method} \${c.req.path} is not implemented yet\`);
});
`;
}

/** @param {string} name */
function routeTest(name) {
  const todo = [
    'TODO: replace the 501 with the real answer, parsed with its contract from @targus/core as',
    'me.test.ts does, and keep the 401 and the request line.',
  ].join(' ');
  return `import { describe, expect, it } from 'vitest';

import { appWith, call } from '../../test/support/api.ts';
import { createCapturingLogger, fakeObservability } from '../../test/support/logs.ts';
import { signIn, withCookie } from '../../test/support/session.ts';

${wrap(todo, '// ')}
describe('GET /api/${name}', () => {
  it('is not implemented yet', async () => {
    const { cookie } = await signIn('octocat');

    const response = await call('/api/${name}', { headers: withCookie(cookie) });

    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: { code: 'not_implemented' } });
  });

  it('answers 401 without a session', async () => {
    const response = await call('/api/${name}');

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('writes one request line naming the route and the reviewer', async () => {
    const logger = createCapturingLogger();
    const app = appWith({}, fakeObservability(logger));
    const { cookie } = await signIn('octocat');

    await call('/api/${name}', { headers: withCookie(cookie) }, app);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({ route: '/api/${name}', principal: 'reviewer', status: 501 });
  });
});
`;
}

/**
 * Mount the route in app.ts under `root`, or say which two lines to add when that cannot be
 * done safely (no app.ts, or not the shape `registerRoute` knows).
 * @param {string} root
 * @param {string} name
 * @param {string} route
 * @param {boolean} register
 * @returns {string[]}
 */
function mount(root, name, route, register) {
  const target = path.join(root, appFile);
  const updated =
    register && existsSync(target)
      ? registerRoute(readFileSync(target, 'utf8'), name, route)
      : null;
  if (updated !== null) {
    writeFileSync(target, updated);
    return [`mounted it in ${appFile} at /api/${name}`];
  }
  const { importLine, mountLine } = registrationLines(name, route);
  return [
    `not mounted: add to ${appFile}, next to the other routes:`,
    `  ${importLine}`,
    `  ${mountLine.trim()}   (inside createApp, after the last app.route)`,
    '  its test answers 404 until you do',
  ];
}

function nextSteps() {
  return [
    'next:',
    '  1. add the request and response schemas to packages/core/src/contracts/',
    '  2. write the use-case in apps/api/src/services/, add it to Services and bindServices in',
    '     apps/api/src/services/index.ts, and call it from the route in place of the TargusError',
    '     a new dependency goes in ServiceDeps (apps/api/src/services/deps.ts) and is supplied',
    '     by createAppDeps in apps/api/src/composition.ts, or by StorageDeps if it holds data',
    '  3. add the endpoint to the route table in apps/api/README.md',
    '  4. replace the generated test with the real behaviour, then run yarn check',
  ];
}

/**
 * @param {string[]} args
 * @param {string} root
 * @returns {Promise<string>}
 */
export async function main(args, root) {
  const register = !args.includes('--no-register');
  const positional = args.filter((arg) => arg !== '--no-register');
  if (positional.length !== 1) throw new Error('usage: yarn new:route <name> [--no-register]');
  const name = requireKebab(positional[0], 'name');
  const route = `${toCamel(name)}Route`;
  const files = await formatted([
    { path: `apps/api/src/routes/${name}.ts`, content: routeSource(name, route) },
    { path: `apps/api/src/routes/${name}.test.ts`, content: routeTest(name) },
  ]);
  const written = writeNewFiles(root, files);
  return [
    ...written.map((file) => `created ${file}`),
    ...mount(root, name, route, register),
    ...nextSteps(),
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) void runCli(main);
