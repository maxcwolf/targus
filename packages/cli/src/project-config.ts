import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Appearance, TargusError } from '@targus/core';
import { z } from 'zod';

import { summarizeIssues } from './errors/zod-summary.ts';

/** The platforms the CLI captures, in the order a multi-platform run takes them (ADR 0038). */
export const capturePlatforms = ['ios', 'web'] as const;
export type CapturePlatformName = (typeof capturePlatforms)[number];

/** `1200x900`: a browser viewport in CSS pixels. */
export const ViewportText = z
  .string()
  .regex(/^[1-9]\d{1,4}x[1-9]\d{1,4}$/, 'expected WIDTHxHEIGHT, e.g. 1200x900')
  .transform((text) => {
    const [width = 0, height = 0] = text.split('x').map(Number);
    return { width, height };
  });

const IosConfig = z.strictObject({
  app: z.string().min(1).optional(),
  udid: z.string().min(1).optional(),
  deviceName: z.string().min(1).optional(),
  appearance: Appearance.optional(),
  bundleId: z.string().min(1).optional(),
});

const WebConfig = z.strictObject({
  storybook: z.string().min(1).optional(),
  viewport: ViewportText.optional(),
  pixelRatio: z.number().positive().max(4).optional(),
  deviceName: z.string().min(1).optional(),
});

/** `targus.config.ts` or `.json`: the platforms a project captures and the settings of each. */
export const ProjectConfig = z.strictObject({
  $schema: z.string().optional(),
  platforms: z
    .strictObject({ ios: IosConfig.optional(), web: WebConfig.optional() })
    .refine((platforms) => Object.keys(platforms).length > 0, 'name at least one platform'),
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;
/**
 * What a `targus.config.ts` exports: the config as written, before validation, so a viewport is
 * still `'1200x900'`.
 */
export type TargusConfig = z.input<typeof ProjectConfig>;

/** Types a `targus.config.ts`: `export default defineConfig({ platforms: { … } })`. */
export function defineConfig(config: TargusConfig): TargusConfig {
  return config;
}
export type IosConfig = z.infer<typeof IosConfig>;
export type WebConfig = z.infer<typeof WebConfig>;

/** The files looked for when `--config` is not given; a project keeps only one of them. */
export const projectConfigFileNames = ['targus.config.ts', 'targus.config.json'] as const;

/** Extensions loaded with `import()`; any other file is read as JSON. */
const moduleExtensions = new Set(['.ts', '.mts', '.js', '.mjs']);

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Paths in the file are relative to the file, so a run from another directory finds them. */
function resolvePaths(config: ProjectConfig, dir: string): ProjectConfig {
  const { ios, web } = config.platforms;
  const platforms: ProjectConfig['platforms'] = {};
  if (ios !== undefined) {
    platforms.ios = ios.app === undefined ? ios : { ...ios, app: path.resolve(dir, ios.app) };
  }
  if (web !== undefined) {
    const { storybook } = web;
    platforms.web =
      storybook === undefined || isUrl(storybook)
        ? web
        : { ...web, storybook: path.resolve(dir, storybook) };
  }
  return { ...config, platforms };
}

function parseJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new TargusError('bad_request', `${file} is not valid JSON`, { cause: error });
  }
}

function validate(value: unknown, file: string): ProjectConfig {
  const parsed = ProjectConfig.safeParse(value);
  if (!parsed.success) {
    throw new TargusError(
      'bad_request',
      `invalid ${file}:\n${summarizeIssues(parsed.error.issues)}`,
    );
  }
  return resolvePaths(parsed.data, path.dirname(file));
}

export interface LoadProjectConfigOptions {
  /** `--config`: must exist. Without it, `projectConfigFileNames` in `cwd` are looked for. */
  readonly file?: string;
  readonly cwd: string;
  readonly read?: (file: string) => Promise<string>;
  /** Import a TypeScript or JavaScript config and answer the module. Default: Node's import. */
  readonly importModule?: (file: string) => Promise<unknown>;
}

interface FoundConfig {
  readonly file: string;
  readonly text: string;
}

const isMissing = (error: unknown): boolean => (error as { code?: unknown }).code === 'ENOENT';

const cannotRead = (file: string, cause?: unknown): TargusError =>
  new TargusError('bad_request', `cannot read the targus config ${file}`, { cause });

async function readIfPresent(
  file: string,
  read: (file: string) => Promise<string>,
): Promise<FoundConfig | null> {
  try {
    return { file, text: await read(file) };
  } catch (error) {
    if (isMissing(error)) return null;
    throw cannotRead(file, error);
  }
}

/** `--config`, which must exist, or the one default file present; `null` when there is none. */
async function findConfig(options: LoadProjectConfigOptions): Promise<FoundConfig | null> {
  const read = options.read ?? ((file: string) => readFile(file, 'utf8'));
  if (options.file !== undefined) {
    const file = path.resolve(options.cwd, options.file);
    const found = await readIfPresent(file, read);
    if (found === null) throw cannotRead(file);
    return found;
  }
  const found: FoundConfig[] = [];
  for (const name of projectConfigFileNames) {
    const config = await readIfPresent(path.resolve(options.cwd, name), read);
    if (config !== null) found.push(config);
  }
  if (found.length > 1) {
    throw new TargusError(
      'bad_request',
      `${options.cwd} has both ${projectConfigFileNames.join(' and ')}: keep one`,
    );
  }
  return found[0] ?? null;
}

const importWithNode = (file: string): Promise<unknown> => import(pathToFileURL(file).href);

function importFailure(file: string, error: unknown): string {
  if ((error as { code?: unknown }).code === 'ERR_UNKNOWN_FILE_EXTENSION') {
    return (
      `cannot load ${file}: a TypeScript config needs Node 22.18 or later, which runs .ts ` +
      'files itself; upgrade Node, or use targus.config.json'
    );
  }
  const reason = error instanceof Error ? error.message : String(error);
  return `cannot load the targus config ${file}: ${reason}`;
}

/** The default export of a TypeScript or JavaScript config. */
async function importConfig(file: string, options: LoadProjectConfigOptions): Promise<unknown> {
  let loaded: unknown;
  try {
    loaded = await (options.importModule ?? importWithNode)(file);
  } catch (error) {
    throw new TargusError('bad_request', importFailure(file, error), { cause: error });
  }
  const exported =
    typeof loaded === 'object' && loaded !== null && 'default' in loaded
      ? loaded.default
      : undefined;
  if (exported === undefined) {
    throw new TargusError(
      'bad_request',
      `${file} has no default export: end it with \`export default defineConfig({ … })\``,
    );
  }
  return exported;
}

/**
 * Read and validate the project config (ADR 0038): `targus.config.ts`, imported by Node, or
 * `targus.config.json`. `null` when there is none and none was asked for.
 */
export async function loadProjectConfig(
  options: LoadProjectConfigOptions,
): Promise<ProjectConfig | null> {
  const found = await findConfig(options);
  if (found === null) return null;
  const { file, text } = found;
  const value = moduleExtensions.has(path.extname(file))
    ? await importConfig(file, options)
    : parseJson(text, file);
  return validate(value, file);
}

/** `--platform ios,web` as a list of known platforms, in run order, without duplicates. */
export function parsePlatformList(text: string): CapturePlatformName[] {
  const names = text
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  const unknown = names.filter((name) => !(capturePlatforms as readonly string[]).includes(name));
  if (names.length === 0 || unknown.length > 0) {
    throw new TargusError(
      'bad_request',
      `--platform takes ${capturePlatforms.join(', ')} or a comma-separated list of them` +
        (unknown.length > 0 ? `, not ${unknown.join(', ')}` : ''),
    );
  }
  return capturePlatforms.filter((platform) => names.includes(platform));
}

/**
 * The platforms a run captures (ADR 0038): `--platform` when given, else every platform in the
 * config, else `ios` as before configs existed.
 */
export function selectPlatforms(
  flag: readonly CapturePlatformName[] | undefined,
  config: ProjectConfig | null,
): CapturePlatformName[] {
  if (flag !== undefined) return [...flag];
  if (config === null) return ['ios'];
  return capturePlatforms.filter((platform) => config.platforms[platform] !== undefined);
}
