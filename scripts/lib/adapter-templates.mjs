// @ts-check
// The text of a generated adapter and its test (scripts/new-adapter.mjs). The output is run
// through Prettier afterwards, so these templates only have to be valid, not pretty.
import { wrap } from './scaffold.mjs';

/**
 * How an adapter receives what it wraps, the way the hand-written adapter of the same port
 * does, and how its generated test builds one.
 * @typedef {object} Wiring
 * @property {string[]} imports source imports other than the one from the core package
 * @property {string} options declarations before the adapter (an options interface, or '')
 * @property {string} members class members before the methods (fields, constructor)
 * @property {string} doc what the doc comment says about dependencies and timeouts
 * @property {string[]} testImports
 * @property {string} construct expression that builds the adapter in its test
 * @property {string} testTodo what the real test should do
 */

/** @type {Record<string, (type: string) => Wiring>} */
export const wirings = {
  exec: (type) => ({
    imports: ["import { execFileBuffer, type Exec } from './exec.adapter.ts';"],
    options: `export interface ${type}Options {
  /** Starts every subprocess (\`exec.adapter.ts\`); a fake \`Exec\` in tests. */
  readonly exec?: Exec;
}`,
    members: `private readonly exec: Exec;

  constructor({ exec = execFileBuffer }: ${type}Options = {}) {
    this.exec = exec;
  }`,
    doc: 'Start every subprocess with `this.exec` and a `timeoutMs` per call, as `SimctlDriver` does with `simctlTimeoutsMs`.',
    testImports: [],
    construct: `new ${type}({ exec: () => Promise.resolve({ stdout: Buffer.alloc(0), stderr: '' }) })`,
    testTodo:
      'drive it with a fake `Exec` and assert each call, its arguments and its `timeoutMs`, as simctl.adapter.test.ts does.',
  }),
  channel: (type) => ({
    imports: [],
    options: `export interface ${type}Options {
  /** How long \`getIndex\` waits for the app to connect and answer. */
  readonly connectTimeoutMs: number;
}`,
    members: `private readonly connectTimeoutMs: number;

  constructor({ connectTimeoutMs }: ${type}Options) {
    this.connectTimeoutMs = connectTimeoutMs;
  }`,
    doc: 'Every wait on the app ends after a timeout with a `TargusError`, as in `WsStorybookChannel`.',
    testImports: [],
    construct: `new ${type}({ connectTimeoutMs: 1000 })`,
    testTodo: 'talk to it from a real client, as ws-channel.adapter.test.ts does.',
  }),
  http: (type) => ({
    imports: ["import type { ImageRepository } from '../repositories/image.repository.ts';"],
    options: `export interface ${type}Options {
  /** Base URL of the service that holds the bytes. */
  readonly endpoint: string;
  /** The images table; \`missing()\` answers from it, not from the stored bytes. */
  readonly metadata: Pick<ImageRepository, 'missing'>;
  /** Sends every request; a stub in tests, so they never touch the network. */
  readonly fetch?: typeof fetch;
}`,
    members: `private readonly endpoint: string;
  private readonly metadata: Pick<ImageRepository, 'missing'>;
  private readonly fetchImpl: typeof fetch;

  constructor({ endpoint, metadata, fetch: fetchImpl = fetch }: ${type}Options) {
    this.endpoint = endpoint;
    this.metadata = metadata;
    this.fetchImpl = fetchImpl;
  }`,
    doc: "Bytes are keyed by content hash, as in `R2ImageStore`, and every request goes through the injected `fetch`. It takes no Cloudflare type (ADR 0023): build it in the host that has the credentials, and add it to that host's `StorageDeps`.",
    testImports: [],
    construct: `new ${type}({ endpoint: 'https://images.test', metadata: { missing: (hashes) => Promise.resolve([...hashes]) }, fetch: () => Promise.resolve(new Response(null, { status: 404 })) })`,
    testTodo:
      'run describeImageStoreContract (test/support/contracts/image-store.contract.ts) against this store over a stubbed fetch, with `record` writing to the metadata it is given, as r2-image-store.test.ts does.',
  }),
  d1: (type) => ({
    imports: [],
    options: '',
    members: 'constructor(private readonly database: D1Database) {}',
    doc: "Rows live in `database` (the `DB` binding). Build reads are scoped by project (ADR 0007). A repository on another database takes that database's client instead of `D1Database`; only repositories/ may name Cloudflare types (ADR 0023).",
    testImports: ["import { env } from 'cloudflare:workers';"],
    construct: `new ${type}(env.DB)`,
    testTodo:
      'run the build contract suites in test/support/contracts/ (build, build-results, build-review, build-paging) with a BuildHarness for this repository, as build.repository.test.ts does with d1BuildHarness.',
  }),
  fetch: (type) => ({
    imports: [],
    options: '',
    members: 'constructor(private readonly fetchImpl: typeof fetch = fetch) {}',
    doc: 'Requests go through `fetchImpl`, so tests pass `createGitHubStub().fetch` and never touch the network.',
    testImports: ["import { createGitHubStub } from '../../test/support/github-stub.ts';"],
    construct: `new ${type}(createGitHubStub().fetch)`,
    testTodo:
      'call it against createGitHubStub() and assert the requests it recorded, as github-client.adapter.test.ts does.',
  }),
};

/**
 * @typedef {object} AdapterSpec
 * @property {string} portType the port's type, e.g. `DeviceDriver`
 * @property {string} implemented the interface the adapter implements (the port, or a superset)
 * @property {string | null} implementedFrom relative import of `implemented`, null for a port
 * @property {string} portFile repo-relative file that declares `implemented`
 * @property {ReadonlyArray<{ readonly name: string; readonly async: boolean }>} methods
 * @property {string} adapter the class or value name
 * @property {string} base the source file name without `.ts`
 * @property {Wiring | null} wiring null for a plain value (`Clock`, `IdGenerator`)
 */

/** @param {AdapterSpec} spec */
function coreImport({ implemented, implementedFrom }) {
  return implementedFrom === null
    ? `import { TargusError, type ${implemented} } from '@targus/core';`
    : `import { TargusError } from '@targus/core';\n\nimport type { ${implemented} } from '${implementedFrom}';`;
}

/** @param {{ readonly name: string; readonly async: boolean }} method */
function stub({ name, async }) {
  return async
    ? `${name}() {\n  return Promise.reject(notImplemented('${name}'));\n}`
    : `${name}() {\n  throw notImplemented('${name}');\n}`;
}

/** @param {AdapterSpec} spec */
function notImplementedHelper({ adapter }) {
  return `/** What every method throws until it is written. */
function notImplemented(method: string): TargusError {
  return new TargusError('not_implemented', \`${adapter}.\${method} is not implemented yet\`);
}`;
}

/** @param {AdapterSpec} spec */
function sourceDoc({ portType, implemented, portFile, wiring }) {
  const what =
    implemented === portType ? `\`${portType}\`` : `\`${implemented}\` (\`${portType}\`)`;
  const text = [
    `${what} adapter. TODO: say what it wraps.`,
    'Adapters are thin: they translate between the port and the real dependency and hold no',
    'business rule (docs/engineering-standards.md 1.2).',
    wiring?.doc ?? '',
    'Each method throws `not_implemented` until it is written; give it the signature in',
    `${portFile} then.`,
  ].join(' ');
  return `/**\n${wrap(text, ' * ')}\n */`;
}

/** @param {AdapterSpec} spec */
export function adapterSource(spec) {
  const { implemented, adapter, methods, wiring } = spec;
  const imports = [coreImport(spec), ...(wiring?.imports ?? [])].join('\n\n');
  const body =
    wiring === null
      ? `export const ${adapter}: ${implemented} = {\n${methods.map(stub).join(',\n')}\n};`
      : `export class ${adapter} implements ${implemented} {\n${wiring.members}\n\n${methods.map(stub).join('\n\n')}\n}`;
  const options = wiring?.options ? `${wiring.options}\n\n` : '';
  return `${imports}\n\n${notImplementedHelper(spec)}\n\n${options}${sourceDoc(spec)}\n${body}\n`;
}

/** @param {AdapterSpec} spec */
export function adapterTest({ adapter, base, methods, wiring }) {
  const calls = methods.map(({ name, async }) =>
    async
      ? `await expect(adapter.${name}()).rejects.toThrow('not implemented');`
      : `expect(() => adapter.${name}()).toThrow('not implemented');`,
  );
  const subject = `const adapter = ${wiring === null ? adapter : wiring.construct};\n\n`;
  const callback = methods.some((method) => method.async) ? 'async () =>' : '() =>';
  const todo = wiring?.testTodo ?? 'assert what it returns, as system-adapters.test.ts does.';
  const imports = [
    ...(wiring?.testImports ?? []),
    "import { describe, expect, it } from 'vitest';",
    '',
    `import { ${adapter} } from './${base}.ts';`,
  ].join('\n');
  return `${imports}

${wrap(`TODO: replace with tests of the real behaviour: ${todo}`, '// ')}
describe('${adapter}', () => {
  it('is not implemented yet', ${callback} {
    ${subject}${calls.join('\n')}
  });
});
`;
}
