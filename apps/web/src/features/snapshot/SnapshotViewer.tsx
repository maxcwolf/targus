import type { Snapshot } from '@targus/core';
import { type ReactElement, useState } from 'react';

import { Tabs } from '../../components/Tabs.js';
import { DiffOverlay, SideBySide, Slider, Toggle } from './ViewerModes.js';

type ViewerMode = 'side-by-side' | 'diff' | 'slider' | 'toggle';
type Zoom = 'fit' | 'actual';

const modes: readonly { id: ViewerMode; label: string }[] = [
  { id: 'side-by-side', label: 'Side-by-side' },
  { id: 'diff', label: 'Diff' },
  { id: 'slider', label: 'Slider' },
  { id: 'toggle', label: 'Toggle' },
];

const components: Record<ViewerMode, (props: { snapshot: Snapshot }) => ReactElement> = {
  'side-by-side': SideBySide,
  diff: DiffOverlay,
  slider: Slider,
  toggle: Toggle,
};

/**
 * Baseline vs current in four modes. Captures are 3x device pixels, so "Fit" scales them to the
 * pane and "100%" shows every captured pixel.
 */
export function SnapshotViewer({ snapshot }: { readonly snapshot: Snapshot }): ReactElement {
  const [mode, setMode] = useState<ViewerMode>('side-by-side');
  const [zoom, setZoom] = useState<Zoom>('fit');
  const Mode = components[mode];
  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <Tabs label="Viewer mode" items={modes} active={mode} onSelect={setMode} />
        <div className="button-group" aria-label="Zoom">
          <button
            type="button"
            className="button small"
            aria-pressed={zoom === 'fit'}
            onClick={() => {
              setZoom('fit');
            }}
          >
            Fit
          </button>
          <button
            type="button"
            className="button small"
            aria-pressed={zoom === 'actual'}
            onClick={() => {
              setZoom('actual');
            }}
          >
            100%
          </button>
        </div>
      </div>
      <div className={`viewer-body zoom-${zoom}`} data-zoom={zoom}>
        <Mode snapshot={snapshot} />
      </div>
    </div>
  );
}
