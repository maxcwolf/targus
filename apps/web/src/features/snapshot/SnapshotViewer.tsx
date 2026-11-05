import type { Snapshot } from '@targus/core';
import { type ReactElement, type ReactNode, useState } from 'react';

import { Tabs } from '../../components/Tabs.js';
import type { ImageKind } from './ImagePane.js';
import { DiffOverlay, hasDiff, SideBySide, Slider, Toggle } from './ViewerModes.js';

type ViewerMode = 'side-by-side' | 'diff' | 'slider' | 'toggle';
type Zoom = 'fit' | 'actual';

const modes: readonly { id: ViewerMode; label: string }[] = [
  { id: 'side-by-side', label: 'Side-by-side' },
  { id: 'diff', label: 'Diff' },
  { id: 'slider', label: 'Slider' },
  { id: 'toggle', label: 'Toggle' },
];

function PressedButton(props: {
  readonly pressed: boolean;
  readonly onPress: () => void;
  readonly children: string;
}): ReactElement {
  return (
    <button
      type="button"
      className="button small"
      aria-pressed={props.pressed}
      onClick={props.onPress}
    >
      {props.children}
    </button>
  );
}

interface ModeControlProps {
  readonly mode: ViewerMode;
  readonly snapshot: Snapshot;
  readonly opacity: number;
  readonly onOpacity: (value: number) => void;
  readonly shown: ImageKind;
  readonly onShown: (kind: ImageKind) => void;
}

/** The toolbar control that belongs to the active mode. */
function ModeControl(props: ModeControlProps): ReactElement | null {
  if (props.mode === 'diff' && hasDiff(props.snapshot)) {
    return (
      <label className="toolbar-range" title="Red pixels are the changes pixelmatch found">
        Diff opacity
        <input
          type="range"
          min={0}
          max={100}
          value={props.opacity}
          onChange={(event) => {
            props.onOpacity(Number(event.target.value));
          }}
        />
      </label>
    );
  }
  if (props.mode !== 'toggle') return null;
  return (
    <div className="segmented">
      <PressedButton
        pressed={props.shown === 'baseline'}
        onPress={() => {
          props.onShown('baseline');
        }}
      >
        Baseline
      </PressedButton>
      <PressedButton
        pressed={props.shown === 'current'}
        onPress={() => {
          props.onShown('current');
        }}
      >
        Current
      </PressedButton>
    </div>
  );
}

function ModeBody(props: ModeControlProps): ReactElement {
  const { mode, snapshot } = props;
  if (mode === 'diff') return <DiffOverlay snapshot={snapshot} opacity={props.opacity} />;
  if (mode === 'slider') return <Slider snapshot={snapshot} />;
  if (mode === 'toggle') return <Toggle snapshot={snapshot} shown={props.shown} />;
  return <SideBySide snapshot={snapshot} />;
}

/**
 * Baseline vs current in four modes under one sticky toolbar, which also carries the review and
 * navigation controls passed as `actions`. "Fit" scales captures (3x device pixels) to the pane
 * height; "100%" shows every captured pixel and lets the pane scroll.
 */
export function SnapshotViewer(props: {
  readonly snapshot: Snapshot;
  readonly actions: ReactNode;
}): ReactElement {
  const [mode, setMode] = useState<ViewerMode>('side-by-side');
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [opacity, setOpacity] = useState(100);
  const [shown, setShown] = useState<ImageKind>('current');
  const state = {
    mode,
    snapshot: props.snapshot,
    opacity,
    onOpacity: setOpacity,
    shown,
    onShown: setShown,
  };
  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        {props.actions}
        <Tabs label="Viewer mode" items={modes} active={mode} onSelect={setMode} />
        <div className="segmented" aria-label="Zoom" role="group">
          <PressedButton
            pressed={zoom === 'fit'}
            onPress={() => {
              setZoom('fit');
            }}
          >
            Fit
          </PressedButton>
          <PressedButton
            pressed={zoom === 'actual'}
            onPress={() => {
              setZoom('actual');
            }}
          >
            100%
          </PressedButton>
        </div>
        <ModeControl {...state} />
      </div>
      <div className={`viewer-pane checkerboard zoom-${zoom}`} data-zoom={zoom}>
        <ModeBody {...state} />
      </div>
    </div>
  );
}
