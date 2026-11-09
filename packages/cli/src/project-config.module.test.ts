import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import { defineConfig, loadProjectConfig, type TargusConfig } from './project-config.ts';

const cwd = '/repo';
const tsFile = path.resolve('/repo/targus.config.ts');
const jsonFile = path.resolve('/repo/targus.config.json');

/** Files that exist; reading any other one fails with ENOENT. */
function reader(files: readonly string[]) {
  return (file: string): Promise<string> =>
    files.includes(file)
      ? Promise.resolve('// imported, not read')
      : Promise.reject(Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' }));
}

const exporting =
  (value: unknown) =>
  (file: string): Promise<unknown> =>
    Promise.resolve({ default: value, file });

describe('loadProjectConfig with targus.config.ts', () => {
  it('imports targus.config.ts and validates its default export like the JSON file', async () => {
    const imported: string[] = [];
    const config = await loadProjectConfig({
      cwd,
      read: reader([tsFile]),
      importModule: (file) => {
        imported.push(file);
        return exporting({
          platforms: { web: { storybook: 'storybook-static', viewport: '390x844' } },
        })(file);
      },
    });

    expect(imported).toEqual([tsFile]);
    expect(config?.platforms.web).toEqual({
      storybook: path.resolve('/repo/storybook-static'),
      viewport: { width: 390, height: 844 },
    });
  });

  it('imports a --config that names a module, and reads any other file as JSON', async () => {
    for (const name of ['ci/targus.mts', 'ci/targus.js', 'ci/targus.mjs']) {
      const config = await loadProjectConfig({
        cwd,
        file: name,
        read: reader([path.resolve(cwd, name)]),
        importModule: exporting({ platforms: { ios: { udid: 'SIM' } } }),
      });
      expect(config?.platforms.ios).toEqual({ udid: 'SIM' });
    }
  });

  it('refuses a project with both targus.config.ts and targus.config.json', async () => {
    await expect(
      loadProjectConfig({ cwd, read: reader([tsFile, jsonFile]), importModule: exporting({}) }),
    ).rejects.toThrow('/repo has both targus.config.ts and targus.config.json: keep one');
  });
});

describe('loadProjectConfig with targus.config.ts errors', () => {
  const load = (importModule: (file: string) => Promise<unknown>) =>
    loadProjectConfig({ cwd, read: reader([tsFile]), importModule });

  it('needs a default export, and validates it', async () => {
    await expect(load(() => Promise.resolve({ platforms: {} }))).rejects.toThrow(
      `${tsFile} has no default export: end it with \`export default defineConfig({ … })\``,
    );
    await expect(load(() => Promise.resolve(null))).rejects.toThrow('has no default export');
    await expect(load(exporting({ platforms: { android: {} } }))).rejects.toThrow(
      new RegExp(`^invalid ${tsFile}:\\n.*platforms: Unrecognized key: "android"`),
    );
  });

  it('explains a Node too old to run TypeScript, and any other import failure', async () => {
    const tooOld = Object.assign(new TypeError('Unknown file extension ".ts"'), {
      code: 'ERR_UNKNOWN_FILE_EXTENSION',
    });
    await expect(load(() => Promise.reject(tooOld))).rejects.toThrow(
      `cannot load ${tsFile}: a TypeScript config needs Node 22.18 or later`,
    );
    await expect(load(() => Promise.reject(new SyntaxError('Unexpected token')))).rejects.toThrow(
      `cannot load the targus config ${tsFile}: Unexpected token`,
    );
  });
});

describe('loadProjectConfig from disk', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'targus-config-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('imports a real targus.config.ts', async () => {
    await writeFile(
      path.join(dir, 'targus.config.ts'),
      [
        "const viewport: string = '800x600';",
        'export default { platforms: { web: { storybook: "https://sb.test", viewport } } };',
      ].join('\n'),
    );

    const config = await loadProjectConfig({ cwd: dir });

    expect(config?.platforms.web).toEqual({
      storybook: 'https://sb.test',
      viewport: { width: 800, height: 600 },
    });
  });
});

describe('defineConfig', () => {
  it('returns the config as given, typed as the config file is written', () => {
    const config = { platforms: { web: { viewport: '1200x900', pixelRatio: 2 } } } as const;

    expect(defineConfig(config)).toBe(config);
    expectTypeOf(defineConfig).parameter(0).toEqualTypeOf<TargusConfig>();
    expectTypeOf<{ platforms: { web: { viewport: number } } }>().not.toExtend<TargusConfig>();
  });
});
