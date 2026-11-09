import { TargusError, type Appearance } from '@targus/core';

import type { Viewport } from '../adapters/chromium.adapter.ts';
import {
  selectPlatforms,
  type CapturePlatformName,
  type IosConfig,
  type ProjectConfig,
} from '../project-config.ts';

/** The flags that say what to capture, before the project config fills the gaps (ADR 0038). */
export interface TargetFlags {
  readonly platforms?: readonly CapturePlatformName[];
  readonly fromCapture?: string;
  readonly deviceName?: string;
  readonly udid?: string;
  readonly app?: string;
  readonly appearance?: Appearance;
  readonly bundleId?: string;
  readonly storybook?: string;
  readonly viewport?: Viewport;
  readonly pixelRatio?: number;
}

/** An iOS capture on a simulator. */
export interface IosTarget {
  readonly kind: 'ios';
  readonly udid: string;
  readonly app: string;
  readonly appearance: Appearance;
  readonly bundleId?: string;
  readonly deviceName?: string;
}

/** A web capture of a built or running Storybook (ADR 0037). */
export interface WebTarget {
  readonly kind: 'web';
  readonly storybook: string;
  readonly viewport: Viewport;
  readonly pixelRatio: number;
  readonly deviceName?: string;
}

/** A capture directory written earlier; its manifest says which platform it is. */
export interface DirTarget {
  readonly kind: 'dir';
  readonly dir: string;
  /** The platform `--platform` asked for, checked against the manifest. */
  readonly platform?: CapturePlatformName;
  readonly deviceName?: string;
}

export type RunTarget = IosTarget | WebTarget | DirTarget;

export const defaultViewport: Viewport = { width: 1200, height: 900 };
export const defaultPixelRatio = 1;

/** Copy `value` under `key` only when it is set, for exact optional properties. */
function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function iosTarget(flags: TargetFlags, config: ProjectConfig | null): IosTarget {
  const settings = config?.platforms.ios ?? {};
  const udid = flags.udid ?? settings.udid;
  const app = flags.app ?? settings.app;
  if (udid === undefined || app === undefined) {
    throw new TargusError('bad_request', 'pass --udid and --app, or --from-capture <dir>');
  }
  return { kind: 'ios', udid, app, ...iosSettings(flags, settings) };
}

/** The iOS settings that have a default or may be absent: flags over the file. */
function iosSettings(flags: TargetFlags, settings: IosConfig) {
  return {
    appearance: flags.appearance ?? settings.appearance ?? 'light',
    ...optional('bundleId', flags.bundleId ?? settings.bundleId),
    ...optional('deviceName', flags.deviceName ?? settings.deviceName),
  };
}

function webTarget(flags: TargetFlags, config: ProjectConfig | null): WebTarget {
  const settings = config?.platforms.web ?? {};
  const storybook = flags.storybook ?? settings.storybook;
  if (storybook === undefined) {
    throw new TargusError(
      'bad_request',
      'pass --storybook <dir or url> for web, or set platforms.web.storybook in the targus ' +
        'config',
    );
  }
  return {
    kind: 'web',
    storybook,
    viewport: flags.viewport ?? settings.viewport ?? defaultViewport,
    pixelRatio: flags.pixelRatio ?? settings.pixelRatio ?? defaultPixelRatio,
    ...optional('deviceName', flags.deviceName ?? settings.deviceName),
  };
}

function dirTarget(dir: string, flags: TargetFlags): DirTarget {
  if (flags.platforms !== undefined && flags.platforms.length > 1) {
    throw new TargusError('bad_request', '--from-capture loads one capture: pass one --platform');
  }
  return {
    kind: 'dir',
    dir,
    ...optional('platform', flags.platforms?.[0]),
    ...optional('deviceName', flags.deviceName),
  };
}

/**
 * What a run captures, one target per platform (ADR 0038): `--from-capture`, else each platform
 * `selectPlatforms` picks, with flags over the project config over the defaults. Everything a
 * target needs is checked here, before any capture starts.
 */
export function resolveTargets(flags: TargetFlags, config: ProjectConfig | null): RunTarget[] {
  if (flags.fromCapture !== undefined) return [dirTarget(flags.fromCapture, flags)];
  const platforms = selectPlatforms(flags.platforms, config);
  if (platforms.length > 1 && flags.deviceName !== undefined) {
    throw new TargusError(
      'bad_request',
      '--device-name names one device: pass one --platform, or set deviceName per platform ' +
        'in the targus config',
    );
  }
  return platforms.map((platform) =>
    platform === 'ios' ? iosTarget(flags, config) : webTarget(flags, config),
  );
}

/** The one target `targus capture` takes; a config naming two platforms needs `--platform`. */
export function resolveCaptureTarget(
  flags: TargetFlags,
  config: ProjectConfig | null,
): IosTarget | WebTarget {
  const platforms = selectPlatforms(flags.platforms, config);
  const [platform] = platforms;
  if (platform === undefined || platforms.length > 1) {
    throw new TargusError(
      'bad_request',
      '`targus capture` captures one platform: pass --platform ios or --platform web',
    );
  }
  return platform === 'ios' ? iosTarget(flags, config) : webTarget(flags, config);
}
