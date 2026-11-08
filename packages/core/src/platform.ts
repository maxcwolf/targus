import type { Build, Platform } from './contracts/build.ts';

/**
 * The GitHub check run a build reports under (ADR 0036): `targus/<platform>`, so an iOS build
 * keeps the `targus/ios` that branch protection may already require.
 */
export function checkRunName(platform: Platform): string {
  return `targus/${platform}`;
}

/**
 * The pixel ratio that shows a build's captures at actual size (ADR 0036): the one the build
 * recorded, else 1 for web (one image pixel per CSS pixel) and 3 for a device (the iPhone scale
 * of every build made before the ratio was recorded).
 */
export function displayPixelRatio(build: Pick<Build, 'platform' | 'pixelRatio'>): number {
  return build.pixelRatio ?? (build.platform === 'web' ? 1 : 3);
}
