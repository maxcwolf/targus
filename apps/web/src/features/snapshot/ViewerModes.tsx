import type { Snapshot } from '@targus/core';
import { type ReactElement, useState } from 'react';

import { imageUrl } from '../../api-client/index.js';
import { CompareSlider } from '../../components/CompareSlider.js';
import { SnapshotImage } from '../../components/SnapshotImage.js';
import { type ImageKind, ImagePane } from './ImagePane.js';

interface ModeProps {
  readonly snapshot: Snapshot;
}

export function SideBySide({ snapshot }: ModeProps): ReactElement {
  return (
    <div className="side-by-side">
      <ImagePane kind="baseline" snapshot={snapshot} />
      <ImagePane kind="current" snapshot={snapshot} />
    </div>
  );
}

/** The pixelmatch diff laid over the current capture, with its opacity on a slider. */
export function DiffOverlay({ snapshot }: ModeProps): ReactElement {
  const [opacity, setOpacity] = useState(70);
  const { diffHash, imageHash } = snapshot;
  if (diffHash === null || imageHash === null) {
    return (
      <div>
        <p className="muted">No diff image for a {snapshot.state} snapshot.</p>
        <ImagePane kind="current" snapshot={snapshot} />
      </div>
    );
  }
  return (
    <div>
      <label className="slider-control">
        Diff opacity
        <input
          type="range"
          min={0}
          max={100}
          value={opacity}
          onChange={(event) => {
            setOpacity(Number(event.target.value));
          }}
        />
      </label>
      <div className="layered checkerboard">
        <SnapshotImage src={imageUrl(imageHash)} alt="Current" />
        <SnapshotImage
          src={imageUrl(diffHash)}
          alt="Diff"
          className="overlay"
          style={{ opacity: opacity / 100 }}
        />
      </div>
    </div>
  );
}

export function Slider({ snapshot }: ModeProps): ReactElement {
  const { baselineHash, imageHash } = snapshot;
  if (baselineHash === null || imageHash === null) {
    return (
      <div>
        <p className="muted">The slider needs both a baseline and a current image.</p>
        <SideBySide snapshot={snapshot} />
      </div>
    );
  }
  return <CompareSlider baselineSrc={imageUrl(baselineHash)} currentSrc={imageUrl(imageHash)} />;
}

export function Toggle({ snapshot }: ModeProps): ReactElement {
  const [shown, setShown] = useState<ImageKind>('current');
  const choice = (kind: ImageKind, label: string): ReactElement => (
    <button
      type="button"
      className="button small"
      aria-pressed={shown === kind}
      onClick={() => {
        setShown(kind);
      }}
    >
      {label}
    </button>
  );
  return (
    <div>
      <div className="button-group">
        {choice('baseline', 'Baseline')}
        {choice('current', 'Current')}
      </div>
      <ImagePane kind={shown} snapshot={snapshot} />
    </div>
  );
}
