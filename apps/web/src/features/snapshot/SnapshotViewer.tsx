import type { Snapshot } from '@targus/core/browser';
import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { ActualSizeIcon, DiffIcon, FitIcon } from '../../components/icons.tsx';
import { releaseFocusOnPointerUp } from '../../components/releaseFocus.ts';
import { DiffFilter } from './Stage.tsx';
import { sizeChange } from './stage-sizes.ts';
import type { DiffStyle, ViewerState } from './useViewer.ts';
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
    <label className="toolbar-range" title="How strongly the changes are marked">
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

const diffStyles: readonly {
  readonly style: DiffStyle;
  readonly name: string;
  readonly title: string;
}[] = [
  { style: 'highlight', name: 'Highlight', title: 'Tint the changed pixels' },
  { style: 'focus', name: 'Focus', title: 'Dim everything but the changes' },
  { style: 'strobe', name: 'Strobe', title: 'Blink the tint, to find a small change' },
];

function DiffStyles({ viewer }: { readonly viewer: ViewerState }): ReactElement {
  return (
    <div className="segmented small" role="group" aria-label="Diff style">
      {diffStyles.map(({ style, name, title }) => (
        <button
          key={style}
          type="button"
          className="segment"
          title={title}
          aria-pressed={viewer.diffStyle === style}
          onClick={() => {
            viewer.setDiffStyle(style);
          }}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

function ViewerTools({ viewer }: { readonly viewer: ViewerState }): ReactElement {
  return (
    <div className="viewer-tools">
      {viewer.diff ? <DiffStyles viewer={viewer} /> : null}
      {viewer.diff ? <OpacityRange viewer={viewer} /> : null}
      <ToolButton
        label="Diff"
        title="Mark the changed pixels over the new image (3)"
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

/** Says so when the two captures differ in size, which the shared canvas would otherwise hide. */
function SizeNote({ viewer }: { readonly viewer: ViewerState }): ReactElement | null {
  const change = sizeChange(viewer.stage.baseline, viewer.stage.current);
  if (change === null) return null;
  return (
    <p className="size-note" role="note">
      <strong>Size changed</strong> {change}. Both are shown at one scale, aligned top left.
    </p>
  );
}

/**
 * Column labels and the icon tools, then the captures. "100%" shows them at the size they had on
 * the device, each image pixel divided by the build's `pixelRatio` (`displayPixelRatio`,
 * ADR 0036), and lets the pane scroll; "Fit" shrinks that, never enlarges it, until the comparison
 * fits the pane both ways.
 */
export function SnapshotViewer(props: {
  readonly snapshot: Snapshot;
  readonly viewer: ViewerState;
  readonly labels: ViewerLabels;
  readonly pixelRatio: number;
}): ReactElement {
  const { viewer } = props;
  const ratio = { '--pixel-ratio': String(props.pixelRatio) } as CSSProperties;
  return (
    <div className="viewer">
      <div className="viewer-head">
        <ColumnLabels viewer={viewer} labels={props.labels} />
        <ViewerTools viewer={viewer} />
      </div>
      <SizeNote viewer={viewer} />
      <DiffFilter />
      <div className={`viewer-pane zoom-${viewer.zoom}`} data-zoom={viewer.zoom} style={ratio}>
        <ViewerBody snapshot={props.snapshot} viewer={viewer} />
      </div>
    </div>
  );
}
