// @ts-check
// `yarn workspace @targus/web dev` serves workspace packages from source (ADR 0010), so nothing
// tree-shakes what the browser loads: an import of Node-only code (pngjs needs util, zlib and
// stream) reaches the browser and the app dies on load with `util.inherits is not a function`,
// while `vite build` and e2e stay green. This walks the dev server's client module graph from
// index.html's entry, the way the browser would, and fails on anything Node-only (ADR 0025).
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createServer } from 'vite';

const webRoot = path.resolve(import.meta.dirname, '../apps/web');
const entry = '/src/main.tsx';
const nodeOnly = /node_modules\/(?:pngjs|pixelmatch)\/|__vite-browser-external|^node:/;

/** @type {import('vite').ViteDevServer} */
let server;

before(async () => {
  // The root pins the web app's Vite version; the server loads apps/web/vite.config.ts.
  server = await createServer({
    root: webRoot,
    configFile: path.join(webRoot, 'vite.config.ts'),
    mode: 'development',
    appType: 'custom',
    logLevel: 'silent',
    // No listening socket, file watcher or dependency pre-bundling: only module resolution and
    // transforms, which is where the "development" condition takes effect.
    server: { middlewareMode: true, hmr: false, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
});

after(async () => {
  await server.close();
});

/**
 * Every module URL the browser would request, starting at `entry`. Application and workspace
 * source is followed; node_modules are recorded but not followed (Vite pre-bundles them).
 * @param {import('vite').ViteDevServer} vite
 */
async function clientGraph(vite) {
  const client = vite.environments.client;
  /** @type {Map<string, string>} url -> the module that imported it */
  const seen = new Map([[entry, 'index.html']]);
  const queue = [entry];
  for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
    if (url.includes('/node_modules/') || nodeOnly.test(url)) continue;
    assert.ok(await client.transformRequest(url), `Vite could not transform ${url}`);
    const node = await client.moduleGraph.getModuleByUrl(url);
    for (const imported of node?.importedModules ?? []) {
      if (seen.has(imported.url)) continue;
      seen.set(imported.url, url);
      queue.push(imported.url);
    }
  }
  return seen;
}

describe('web dev server', () => {
  it('serves the app without any Node-only module in the client graph', async () => {
    const graph = await clientGraph(server);
    const offenders = [...graph].filter(([url]) => nodeOnly.test(url));

    assert.ok(graph.size > 50, `walked only ${graph.size} modules from ${entry}`);
    assert.deepEqual(
      offenders.map(([url, importer]) => `${importer} -> ${url}`),
      [],
      'Node-only code reaches the browser; web code must import @targus/core/browser (ADR 0025)',
    );
  });
});
