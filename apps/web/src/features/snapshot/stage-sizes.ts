import type { Snapshot } from '@targus/core/browser';

import { imageUrl } from '../../api-client/index.ts';

/** An image's size in its own pixels. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * What the viewer knows of a snapshot's image sizes. `canvas` is the box every image is laid on,
 * top left, at one scale: as wide as the widest and as tall as the tallest, which is the canvas
 * the diff was computed on (core's `diffImages`). Null until one size is known.
 */
export interface StageSizes {
  readonly baseline: Size | undefined;
  readonly current: Size | undefined;
  readonly diff: Size | undefined;
  readonly canvas: Size | null;
}

/** The smallest box that holds every known size; null when none is known. */
export function canvasOf(sizes: readonly (Size | undefined)[]): Size | null {
  const known = sizes.filter((size): size is Size => size !== undefined);
  if (known.length === 0) return null;
  return {
    width: Math.max(...known.map((size) => size.width)),
    height: Math.max(...known.map((size) => size.height)),
  };
}

function recordedSize(snapshot: Snapshot): Size | undefined {
  const { width, height } = snapshot;
  return width !== null && height !== null ? { width, height } : undefined;
}

/**
 * The sizes of a snapshot's images: each as the browser decoded it, and until then the new
 * capture's from its snapshot row, so the usual same-size comparison never moves as images arrive.
 */
export function stageSizes(
  snapshot: Snapshot,
  loaded: ReadonlyMap<string, Size | null>,
): StageSizes {
  const sizeOf = (hash: string | null): Size | undefined =>
    hash === null ? undefined : (loaded.get(imageUrl(hash)) ?? undefined);
  const baseline = sizeOf(snapshot.baselineHash);
  const current =
    sizeOf(snapshot.imageHash) ??
    (snapshot.imageHash === null ? undefined : recordedSize(snapshot));
  const diff = sizeOf(snapshot.diffHash);
  return { baseline, current, diff, canvas: canvasOf([baseline, current, diff]) };
}

function percent(fraction: number): string {
  return `${String(Math.round(fraction * 10000) / 100)}%`;
}

/** The share of the canvas an image covers; all of it while either size is unknown. */
export function layerBox(
  size: Size | undefined,
  canvas: Size | null,
): { readonly width: string; readonly height: string } {
  if (size === undefined || canvas === null) return { width: '100%', height: '100%' };
  return {
    width: percent(size.width / canvas.width),
    height: percent(size.height / canvas.height),
  };
}

/**
 * The `clip-path` that cuts an image at the slider's split, `position` percent across the canvas:
 * the baseline keeps what is left of it, the new capture what is right of it. An image narrower
 * than the canvas is clipped where the split crosses it, so neither shows through the other.
 */
export function splitClip(
  side: 'baseline' | 'current',
  position: number,
  size: Size | undefined,
  canvas: Size | null,
): string {
  const share = size === undefined || canvas === null ? 1 : size.width / canvas.width;
  const at = Math.min(1, position / 100 / share);
  return side === 'baseline' ? `inset(0 ${percent(1 - at)} 0 0)` : `inset(0 0 0 ${percent(at)})`;
}

/** "780 × 290 → 780 × 434 px" when the two captures differ in size, else null. */
export function sizeChange(baseline: Size | undefined, current: Size | undefined): string | null {
  if (baseline === undefined || current === undefined) return null;
  if (baseline.width === current.width && baseline.height === current.height) return null;
  const text = (size: Size): string => `${String(size.width)} × ${String(size.height)}`;
  return `${text(baseline)} → ${text(current)} px`;
}
