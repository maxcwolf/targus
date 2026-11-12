import type { Snapshot } from '@targus/core/browser';
import { useCallback, useState } from 'react';

import { imageUrl } from '../../api-client/index.ts';
import { type Size, stageSizes, type StageSizes } from './stage-sizes.ts';
import { useHotkeys } from './useHotkeys.ts';

export type ViewerMode = 'one-up' | 'two-up' | 'slider';
export type ImageKind = 'baseline' | 'current';
export type Zoom = 'fit' | 'actual';
/**
 * How Diff shows the changed pixels: tinted (`highlight`), tinted and blinking (`strobe`), or
 * left as they are while the rest of the capture is dimmed (`focus`).
 */
export type DiffStyle = 'highlight' | 'focus' | 'strobe';

export interface ViewerState {
  readonly mode: ViewerMode;
  readonly side: ImageKind;
  readonly diff: boolean;
  readonly zoom: Zoom;
  readonly opacity: number;
  readonly diffStyle: DiffStyle;
  /** Whether the Diff toggle can do anything for this snapshot and mode. */
  readonly diffAvailable: boolean;
  /** Whether every image the viewer shows for this snapshot has loaded (true when it shows none). */
  readonly imagesLoaded: boolean;
  /** The sizes of this snapshot's images and the canvas they share. */
  readonly stage: StageSizes;
  /** Record that the image at this URL has loaded, and its size in its own pixels. */
  readonly onImageLoad: (src: string, size: Size) => void;
  readonly setMode: (mode: ViewerMode) => void;
  readonly setSide: (side: ImageKind) => void;
  readonly toggleDiff: () => void;
  readonly setZoom: (zoom: Zoom) => void;
  readonly setOpacity: (opacity: number) => void;
  readonly setDiffStyle: (style: DiffStyle) => void;
}

/** Opacity of the highlight when Diff is first turned on: the capture under it stays readable. */
const defaultDiffOpacity = 60;

/** Whether a snapshot has a pixelmatch diff to lay over its new capture. */
export function hasDiff(snapshot: Snapshot): boolean {
  return snapshot.diffHash !== null && snapshot.imageHash !== null;
}

interface Shown {
  readonly mode: ViewerMode;
  readonly side: ImageKind;
  readonly diff: boolean;
}

/** The hashes that 1 up, 2 up or the slider puts on screen; the diff never over a lone baseline. */
function shownHashes(snapshot: Snapshot, { mode, side, diff }: Shown): readonly (string | null)[] {
  const overlay = diff ? [snapshot.diffHash] : [];
  if (mode === 'one-up') {
    return side === 'baseline' ? [snapshot.baselineHash] : [snapshot.imageHash, ...overlay];
  }
  return [snapshot.baselineHash, snapshot.imageHash, ...overlay];
}

/** The URLs of the images the viewer shows for this snapshot. */
function shownImages(snapshot: Snapshot, shown: Shown): readonly string[] {
  return shownHashes(snapshot, shown)
    .filter((hash): hash is string => hash !== null)
    .map(imageUrl);
}

/**
 * The image URLs that have loaded on this page, each with its size (null when the browser gave
 * none). Images are content-addressed, so a URL that has loaded once shows the same pixels for
 * any snapshot that references it.
 */
function useLoadedImages(): [ReadonlyMap<string, Size | null>, (src: string, size: Size) => void] {
  const [loaded, setLoaded] = useState<ReadonlyMap<string, Size | null>>(new Map());
  const onImageLoad = useCallback((src: string, size: Size) => {
    const known = size.width > 0 && size.height > 0 ? size : null;
    setLoaded((current) => (current.has(src) ? current : new Map([...current, [src, known]])));
  }, []);
  return [loaded, onImageLoad];
}

/**
 * The viewer's mode, Diff overlay, zoom and opacity, kept across snapshots as the reviewer moves
 * on. Keys: `1` 1 up, `2` 2 up, `3` toggle Diff, `s` switch Baseline/New in 1 up.
 */
export function useViewer(snapshot: Snapshot): ViewerState {
  const [mode, setMode] = useState<ViewerMode>('two-up');
  const [side, setSide] = useState<ImageKind>('current');
  const [diffOn, setDiffOn] = useState(false);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [opacity, setOpacity] = useState(defaultDiffOpacity);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('highlight');
  const [loaded, onImageLoad] = useLoadedImages();
  const diffAvailable = hasDiff(snapshot);
  const diff = diffOn && diffAvailable;
  const imagesLoaded = shownImages(snapshot, { mode, side, diff }).every((src) => loaded.has(src));
  const toggleDiff = (): void => {
    if (diffAvailable) setDiffOn(!diffOn);
  };
  useHotkeys({
    '1': () => {
      setMode('one-up');
    },
    '2': () => {
      setMode('two-up');
    },
    '3': toggleDiff,
    s: () => {
      if (mode === 'one-up') setSide(side === 'current' ? 'baseline' : 'current');
    },
  });
  return {
    mode,
    side,
    diff,
    zoom,
    opacity,
    diffStyle,
    diffAvailable,
    imagesLoaded,
    stage: stageSizes(snapshot, loaded),
    onImageLoad,
    setMode,
    setSide,
    toggleDiff,
    setZoom,
    setOpacity,
    setDiffStyle,
  };
}
