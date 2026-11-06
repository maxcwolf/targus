import type { Snapshot } from '@targus/core/browser';
import type { ReactElement, ReactNode } from 'react';

import { ActualSizeIcon, DiffIcon, FitIcon } from '../../components/icons.tsx';
import { releaseFocusOnPointerUp } from '../../components/releaseFocus.ts';
import type { ViewerState } from './useViewer.ts';
import { ViewerBody } from './ViewerModes.tsx';

export interface ViewerLabels {
  /** e.g. "Build 11 on main", or "none". */
  readonly baseline: string;
  /** e.g. "Build 12 on feature/buttons". */
  readonly current: string;
}

function ToolButton(props: {
  readonly label: string;
  readonly title: string;
  readonly pressed: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      className="icon-button tool"
      aria-label={props.label}
      title={props.title}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onPress}
    >
      {props.children}
    </button>
  );
}

function Column({ name, detail }: { readonly name: string; readonly detail: string }) {
  return (
    <span className="column-label">
      <strong>{name}</strong> <span className="lighter">{detail}</span>
    </span>
  );
}

function ColumnLabels({
  viewer,
  labels,
}: {
  readonly viewer: ViewerState;
  readonly labels: ViewerLabels;
}) {
  if (viewer.mode === 'one-up') {
    return (
      <div className="column-labels">
        <div className="segmented small" role="group" aria-label="Image">
          <button
            type="button"
            className="segment"
            aria-pressed={viewer.side === 'baseline'}
            onClick={() => {
              viewer.setSide('baseline');
            }}
          >
            Baseline
          </button>
          <button
            type="button"
            className="segment"
            aria-pressed={viewer.side === 'current'}
            onClick={() => {
              viewer.setSide('current');
            }}
          >
            New
          </button>
        </div>
        <span className="lighter">
          {viewer.side === 'baseline' ? labels.baseline : labels.current}
        </span>
      </div>
    );
  }
  return (
    <div className={viewer.mode === 'two-up' ? 'column-labels two' : 'column-labels split'}>
      <Column name="Baseline" detail={labels.baseline} />
      <Column name="New" detail={labels.current} />
    </div>
  );
}

function OpacityRange({ viewer }: { readonly viewer: ViewerState }): ReactElement {
  return (
    <label className="toolbar-range" title="Red pixels are the changes pixelmatch found">
      Diff opacity
      <input
        type="range"
        min={0}
        max={100}
        value={viewer.opacity}
        onPointerDown={releaseFocusOnPointerUp}
        onChange={(event) => {
          viewer.setOpacity(Number(event.target.value));
        }}
      />
    </label>
  );
}

function ViewerTools({ viewer }: { readonly viewer: ViewerState }): ReactElement {
  return (
    <div className="viewer-tools">
      {viewer.diff ? <OpacityRange viewer={viewer} /> : null}
      <ToolButton
        label="Diff"
        title="Show the diff over the new image (3). Red pixels changed."
        pressed={viewer.diff}
        disabled={!viewer.diffAvailable}
        onPress={viewer.toggleDiff}
      >
        <DiffIcon />
        <span className="tool-text">Diff</span>
      </ToolButton>
      <ToolButton
        label="Fit"
        title="Fit to the pane"
        pressed={viewer.zoom === 'fit'}
        onPress={() => {
          viewer.setZoom('fit');
        }}
      >
        <FitIcon />
      </ToolButton>
      <ToolButton
        label="100%"
        title="Actual size"
        pressed={viewer.zoom === 'actual'}
        onPress={() => {
          viewer.setZoom('actual');
        }}
      >
        <ActualSizeIcon />
      </ToolButton>
    </div>
  );
}

/**
 * Column labels and the icon tools, then the captures. "Fit" scales captures (3x device pixels)
 * to the pane height; "100%" shows every pixel and lets the pane scroll.
 */
export function SnapshotViewer(props: {
  readonly snapshot: Snapshot;
  readonly viewer: ViewerState;
  readonly labels: ViewerLabels;
}): ReactElement {
  const { viewer } = props;
  return (
    <div className="viewer">
      <div className="viewer-head">
        <ColumnLabels viewer={viewer} labels={props.labels} />
        <ViewerTools viewer={viewer} />
      </div>
      <div className={`viewer-pane zoom-${viewer.zoom}`} data-zoom={viewer.zoom}>
        <ViewerBody snapshot={props.snapshot} viewer={viewer} />
      </div>
    </div>
  );
}
