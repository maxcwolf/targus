// @ts-check
// yarn new:adapter <port> <name> [--in api|cli]
// Creates an adapter for a @targus/core port in the layer that owns it, with a test beside it.
import { pathToFileURL } from 'node:url';

import { requireKebab, runCli, toPascal, writeNewFiles } from './lib/scaffold.mjs';

/** Where each port's adapters live by default (docs/engineering-standards.md section 1.2). */
const layers = {
  'device-driver': { in: 'cli', dir: 'packages/cli/src/adapters' },
  'storybook-channel': { in: 'cli', dir: 'packages/cli/src/adapters' },
  'image-store': { in: 'api', dir: 'apps/api/src/storage' },
  'build-repository': { in: 'api', dir: 'apps/api/src/repositories' },
  'github-client': { in: 'api', dir: 'apps/api/src/adapters' },
  clock: { in: 'api', dir: 'apps/api/src/adapters' },
  'id-generator': { in: 'api', dir: 'apps/api/src/adapters' },
};

/** @type {Record<string, string>} */
const adapterDirs = { api: 'apps/api/src/adapters', cli: 'packages/cli/src/adapters' };

/** @param {string | undefined} port */
function resolvePort(port) {
  const kebab = requireKebab(port, 'port');
  if (!Object.hasOwn(layers, kebab)) {
    throw new Error(`unknown port "${kebab}"; expected one of ${Object.keys(layers).join(', ')}`);
  }
  return /** @type {keyof typeof layers} */ (kebab);
}

/** @param {string[]} args */
function parseArgs(args) {
  const flag = args.indexOf('--in');
  const target = flag === -1 ? undefined : args[flag + 1];
  const positional =
    flag === -1 ? args : args.filter((_, index) => index !== flag && index !== flag + 1);
  if (target !== undefined && !Object.hasOwn(adapterDirs, target)) {
    throw new Error(`--in must be "api" or "cli" (got "${target}")`);
  }
  if (positional.length !== 2)
    throw new Error('usage: yarn new:adapter <port> <name> [--in api|cli]');
  return { port: resolvePort(positional[0]), name: requireKebab(positional[1], 'name'), target };
}

/**
 * @param {string} portType
 * @param {string} adapterType
 * @param {string} base
 */
function templates(portType, adapterType, base) {
  const factory = `create${adapterType}`;
  const source = `import type { ${portType} } from '@targus/core';

/**
 * ${adapterType}: the \`${portType}\` adapter. Adapters are thin: they translate between the port
 * and the real dependency and hold no business rules (docs/engineering-standards.md 1.2).
 */
export function ${factory}(): ${portType} {
  throw new Error('${adapterType} is not implemented yet');
}
`;
  const test = `import { describe, expect, it } from 'vitest';

import { ${factory} } from './${base}.js';

describe('${adapterType}', () => {
  // TODO: replace with an integration test against the real dependency this adapter wraps.
  it('is not implemented yet', () => {
    expect(() => ${factory}()).toThrow('not implemented');
  });
});
`;
  return { source, test };
}

/**
 * @param {string[]} args
 * @param {string} root
 * @returns {string}
 */
export function main(args, root) {
  const { port, name, target } = parseArgs(args);
  const layer = layers[port];
  const dir = target === undefined || target === layer.in ? layer.dir : adapterDirs[target];
  const portType = toPascal(port);
  const adapterType = toPascal(`${name}-${port}`);
  const base = `${name}-${port}.adapter`;
  const { source, test } = templates(portType, adapterType, base);

  // Both layers already depend on @targus/core (packages/cli and apps/api package.json).
  const written = writeNewFiles(root, [
    { path: `${dir}/${base}.ts`, content: source },
    { path: `${dir}/${base}.test.ts`, content: test },
  ]);
  return written.map((file) => `created ${file}`).join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runCli(main);
