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

import type { AppEnv } from '../bindings.js';

/**
 * \`/api/${name}\`: HTTP concerns only. Parse the request with a contract from @targus/core,
 * call one service, and map its result. Never import a repository or storage adapter here.
 */
export const ${route} = new Hono<AppEnv>().get('/', () => {
  throw new TargusError('not_implemented', 'GET /api/${name} is not implemented yet');
});
`;
  const test = `import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { AppEnv } from '../bindings.js';
import { errorHandler } from '../errors.js';
import { ${route} } from './${name}.js';

describe('GET /api/${name}', () => {
  // TODO: replace with the route's real behaviour and assert the body against its contract.
  it('is not implemented yet', async () => {
    const app = new Hono<AppEnv>().route('/', ${route});
    app.onError(errorHandler);

    expect((await app.request('/')).status).toBe(501);
  });
});
`;
  return { route, source, test };
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
  return [
    ...written.map((file) => `created ${file}`),
    `next: mount it in apps/api/src/index.ts with app.route('/api/${name}', ${route})`,
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runCli(main);
