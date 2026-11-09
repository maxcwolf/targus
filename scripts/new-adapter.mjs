// @ts-check
// yarn new:adapter <port> <name> [--in api|cli]
// Creates an adapter for a @targus/core port in the layer that owns it, with a test beside it.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { adapterSource, adapterTest, wirings } from './lib/adapter-templates.mjs';
import { portMethods } from './lib/port-methods.mjs';
import {
  formatted,
  requireKebab,
  runCli,
  toCamel,
  toPascal,
  wrap,
  writeNewFiles,
} from './lib/scaffold.mjs';

/** The checkout this script belongs to; ports are read from it, files written to `root`. */
const repoRoot = path.resolve(import.meta.dirname, '..');

/**
 * @typedef {object} Layer
 * @property {string} dir where the hand-written adapters of this port live
 * @property {(name: string) => string} file the source file name, without `.ts`
 * @property {string} wire where to construct it once it works, printed after the files
 */

/**
 * @typedef {object} Port
 * @property {string} type the port's exported type name, spelled out: `GitHubClient` is not
 *   the PascalCase of `github-client`
 * @property {Partial<Record<'api' | 'cli', Layer>>} layers the first is the default
 * @property {string | null} wiring a key of `wirings`, or null for a plain value
 * @property {{ type: string; file: string } | undefined} [superset] the layer's superset of
 *   the port that its adapters implement (repo-relative file)
 */

const cliAdapters = 'packages/cli/src/adapters';
const storageWire = (/** @type {string} */ key) =>
  `${key} of a host's StorageDeps: createCloudflareStorage in apps/api/src/cloudflare/worker-deps.ts for a Cloudflare-backed one, or another host's own builder; createAppDeps in apps/api/src/composition.ts joins it with the rest`;
const apiValue = 'createAppDeps and systemObservability in apps/api/src/composition.ts';
const cliValue = 'the commands in packages/cli/src/commands/ that pass systemClock today';
const apiAdapters = 'apps/api/src/adapters';
/** @param {string} port */
const adapterFile = (port) => (/** @type {string} */ name) => `${name}-${port}.adapter`;

/** Each port, where its adapters live (docs/engineering-standards.md 1.2) and how they look. */
/** @type {Record<string, Port>} */
const ports = {
  'device-driver': {
    type: 'DeviceDriver',
    layers: {
      cli: {
        dir: cliAdapters,
        file: adapterFile('device-driver'),
        wire: 'createDriver in packages/cli/src/commands/capture.ts, and run.ts, where SimctlDriver is built',
      },
    },
    wiring: 'exec',
  },
  'storybook-channel': {
    type: 'StorybookChannel',
    layers: {
      cli: {
        dir: cliAdapters,
        file: adapterFile('storybook-channel'),
        wire: 'openChannel in packages/cli/src/commands/capture.ts, where WsStorybookChannel is opened',
      },
    },
    wiring: 'channel',
  },
  'image-store': {
    type: 'ImageStore',
    layers: {
      api: {
        dir: 'apps/api/src/storage',
        file: (name) => `${name}-image-store`,
        wire: storageWire('imageStore'),
      },
    },
    wiring: 'http',
  },
  'build-repository': {
    type: 'BuildRepository',
    layers: {
      api: {
        dir: 'apps/api/src/repositories',
        file: (name) => `${name}-build.repository`,
        wire: storageWire('builds'),
      },
    },
    wiring: 'd1',
    superset: {
      type: 'ApiBuildRepository',
      file: 'apps/api/src/ports/build-repository.ts',
    },
  },
  'github-client': {
    type: 'GitHubClient',
    layers: {
      api: {
        dir: apiAdapters,
        file: adapterFile('github-client'),
        wire: 'githubFor in apps/api/src/composition.ts (createAppDeps)',
      },
    },
    wiring: 'fetch',
  },
  clock: {
    type: 'Clock',
    layers: {
      api: { dir: apiAdapters, file: adapterFile('clock'), wire: apiValue },
      cli: { dir: cliAdapters, file: adapterFile('clock'), wire: cliValue },
    },
    wiring: null,
  },
  'id-generator': {
    type: 'IdGenerator',
    layers: {
      api: { dir: apiAdapters, file: adapterFile('id-generator'), wire: apiValue },
      cli: { dir: cliAdapters, file: adapterFile('id-generator'), wire: cliValue },
    },
    wiring: null,
  },
};

/** @param {string | undefined} value */
function resolvePort(value) {
  const kebab = requireKebab(value, 'port');
  const port = ports[kebab];
  if (port === undefined) {
    throw new Error(`unknown port "${kebab}"; expected one of ${Object.keys(ports).join(', ')}`);
  }
  return { key: kebab, port };
}

/**
 * @param {Port} port
 * @param {string} key
 * @param {string | undefined} target
 * @returns {Layer}
 */
function resolveLayer(port, key, target) {
  if (target !== undefined && target !== 'api' && target !== 'cli') {
    throw new Error(`--in must be "api" or "cli" (got "${target}")`);
  }
  const layer = target === undefined ? Object.values(port.layers)[0] : port.layers[target];
  if (layer === undefined) {
    const owners = Object.keys(port.layers).join(' or ');
    throw new Error(`${key} adapters live only in ${owners}; --in ${String(target)} has none`);
  }
  return layer;
}

/** @param {string[]} args */
function parseArgs(args) {
  const flag = args.indexOf('--in');
  const target = flag === -1 ? undefined : args[flag + 1];
  const positional =
    flag === -1 ? args : args.filter((_, index) => index !== flag && index !== flag + 1);
  if (positional.length !== 2)
    throw new Error('usage: yarn new:adapter <port> <name> [--in api|cli]');
  const { key, port } = resolvePort(positional[0]);
  const name = requireKebab(positional[1], 'name');
  return { port, name, layer: resolveLayer(port, key, target) };
}

/** @param {string} type */
function corePortFile(type) {
  const key = Object.keys(ports).find((candidate) => ports[candidate]?.type === type);
  if (key === undefined) throw new Error(`${type} is not a port this generator knows`);
  return `packages/core/src/ports/${key}.ts`;
}

/**
 * The methods of `type` declared in `file` (repo-relative), read from the source.
 * @param {string} file
 * @param {string} type
 * @returns {import('./lib/port-methods.mjs').PortMethod[]}
 */
function methodsOf(file, type) {
  return portMethods(path.join(repoRoot, file), type, (base) =>
    methodsOf(corePortFile(base), base),
  );
}

/**
 * @param {Port} port
 * @param {string} adapter
 */
function wiringOf(port, adapter) {
  if (port.wiring === null) return null;
  const wiring = wirings[port.wiring];
  if (wiring === undefined) throw new Error(`no wiring "${port.wiring}" for ${port.type}`);
  return wiring(adapter);
}

/**
 * @param {string[]} args
 * @param {string} root
 * @returns {Promise<string>}
 */
export async function main(args, root) {
  const { port, name, layer } = parseArgs(args);
  const base = layer.file(name);
  const implemented = port.superset?.type ?? port.type;
  const portFile = port.superset?.file ?? corePortFile(port.type);
  const adapter = `${toPascal(name)}${port.type}`;
  /** @type {import('./lib/adapter-templates.mjs').AdapterSpec} */
  const spec = {
    portType: port.type,
    implemented,
    implementedFrom:
      port.superset === undefined ? null : path.posix.relative(layer.dir, port.superset.file),
    portFile,
    methods: methodsOf(portFile, implemented),
    adapter: port.wiring === null ? toCamel(adapter) : adapter,
    base,
    wiring: wiringOf(port, adapter),
  };
  // Both layers already depend on @targus/core (packages/cli and apps/api package.json).
  const files = await formatted([
    { path: `${layer.dir}/${base}.ts`, content: adapterSource(spec) },
    { path: `${layer.dir}/${base}.test.ts`, content: adapterTest(spec) },
  ]);
  return [
    ...writeNewFiles(root, files).map((file) => `created ${file}`),
    'next:',
    '  1. write each method with the signature from the port, and its test',
    wrap(`2. wire it in: ${layer.wire}`, '     ').replace(/^ {5}/, '  '),
    '  3. run yarn check',
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) void runCli(main);
