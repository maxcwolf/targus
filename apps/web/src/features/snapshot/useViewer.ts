import type { Snapshot } from '@targus/core/browser';
import { useCallback, useState } from 'react';

import { imageUrl } from '../../api-client/index.ts';
import { useHotkeys } from './useHotkeys.ts';

export type ViewerMode = 'one-up' | 'two-up' | 'slider';
export type ImageKind = 'baseline' | 'current';
export type Zoom = 'fit' | 'actual';

export interface ViewerState {
  readonly mode: ViewerMode;
  readonly side: ImageKind;
  readonly diff: boolean;
  readonly zoom: Zoom;
  readonly opacity: number;
  /** Whether the Diff toggle can do anything for this snapshot and mode. */
  readonly diffAvailable: boolean;
  /** Whether every image the viewer shows for this snapshot has loaded (true when it shows none). */
  readonly imagesLoaded: boolean;
  /** Record that the image at this URL has loaded. */
  readonly onImageLoad: (src: string) => void;
  readonly setMode: (mode: ViewerMode) => void;
  readonly setSide: (side: ImageKind) => void;
  readonly toggleDiff: () => void;
  readonly setZoom: (zoom: Zoom) => void;
  readonly setOpacity: (opacity: number) => void;
}

/** Whether a snapshot has a pixelmatch diff to lay over its new capture. */
export function hasDiff(snapshot: Snapshot): boolean {
  return snapshot.diffHash !== null && snapshot.imageHash !== null;
}

interface Shown {
  readonly mode: ViewerMode;
  readonly side: ImageKind;
  readonly diff: boolean;
}

/** The hashes that 1 up, 2 up or the slider puts on screen; the diff only over the new capture. */
function shownHashes(snapshot: Snapshot, { mode, side, diff }: Shown): readonly (string | null)[] {
  const overlay = diff ? [snapshot.diffHash] : [];
  if (mode === 'one-up') {
    return side === 'baseline' ? [snapshot.baselineHash] : [snapshot.imageHash, ...overlay];
  }
  // The slider, or 2 up in its place when one side is missing, never shows the diff.
  return [snapshot.baselineHash, snapshot.imageHash, ...overlay];
}

/** The URLs of the images the viewer shows for this snapshot. */
function shownImages(snapshot: Snapshot, shown: Shown): readonly string[] {
  return shownHashes(snapshot, shown)
    .filter((hash): hash is string => hash !== null)
    .map(imageUrl);
}

/**
 * The image URLs that have loaded on this page. Images are content-addressed, so a URL that has
 * loaded once shows the same pixels for any snapshot that references it.
 */
function useLoadedImages(): [ReadonlySet<string>, (src: string) => void] {
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const onImageLoad = useCallback((src: string) => {
    setLoaded((current) => (current.has(src) ? current : new Set([...current, src])));
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
  const [opacity, setOpacity] = useState(100);
  const [loaded, onImageLoad] = useLoadedImages();
  const diffAvailable = hasDiff(snapshot) && mode !== 'slider';
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
    diffAvailable,
    imagesLoaded,
    onImageLoad,
    setMode,
    setSide,
    toggleDiff,
    setZoom,
    setOpacity,
  };
}
