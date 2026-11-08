import { readFile } from 'node:fs/promises';
import path from 'node:path';

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

/** `targus.config.json`: the platforms a project captures and the settings of each. */
export const ProjectConfig = z.strictObject({
  $schema: z.string().optional(),
  platforms: z
    .strictObject({ ios: IosConfig.optional(), web: WebConfig.optional() })
    .refine((platforms) => Object.keys(platforms).length > 0, 'name at least one platform'),
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;
export type IosConfig = z.infer<typeof IosConfig>;
export type WebConfig = z.infer<typeof WebConfig>;

export const projectConfigFileName = 'targus.config.json';

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

function parseConfig(text: string, file: string): ProjectConfig {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new TargusError('bad_request', `${file} is not valid JSON`, { cause: error });
  }
  const parsed = ProjectConfig.safeParse(json);
  if (!parsed.success) {
    throw new TargusError(
      'bad_request',
      `invalid ${file}:\n${summarizeIssues(parsed.error.issues)}`,
    );
  }
  return resolvePaths(parsed.data, path.dirname(file));
}

export interface LoadProjectConfigOptions {
  /** `--config`: must exist. Without it, `targus.config.json` in `cwd` is read if present. */
  readonly file?: string;
  readonly cwd: string;
  readonly read?: (file: string) => Promise<string>;
}

/** Read and validate the project config; `null` when there is none and none was asked for. */
export async function loadProjectConfig(
  options: LoadProjectConfigOptions,
): Promise<ProjectConfig | null> {
  const read = options.read ?? ((file: string) => readFile(file, 'utf8'));
  const file = path.resolve(options.cwd, options.file ?? projectConfigFileName);
  let text: string;
  try {
    text = await read(file);
  } catch (error) {
    if (options.file === undefined && (error as { code?: unknown }).code === 'ENOENT') return null;
    throw new TargusError('bad_request', `cannot read the targus config ${file}`, { cause: error });
  }
  return parseConfig(text, file);
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
