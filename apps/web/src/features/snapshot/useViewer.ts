import type { Snapshot } from '@targus/core';
import { useState } from 'react';

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
  const diffAvailable = hasDiff(snapshot) && mode !== 'slider';
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
    diff: diffOn && diffAvailable,
    zoom,
    opacity,
    diffAvailable,
    setMode,
    setSide,
    toggleDiff,
    setZoom,
    setOpacity,
  };
}
