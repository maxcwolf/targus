import type { Snapshot } from '@targus/core';
import type { ReactElement } from 'react';

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

/** Whether the Diff mode has an image to lay over the current capture. */
export function hasDiff(snapshot: Snapshot): boolean {
  return snapshot.diffHash !== null && snapshot.imageHash !== null;
}

/** The pixelmatch diff laid over the current capture; the toolbar owns the opacity. */
export function DiffOverlay({
  snapshot,
  opacity,
}: ModeProps & { readonly opacity: number }): ReactElement {
  const { diffHash, imageHash } = snapshot;
  if (diffHash === null || imageHash === null) {
    return (
      <div className="mode-fallback">
        <p className="muted">No diff image for a {snapshot.state} snapshot.</p>
        <ImagePane kind="current" snapshot={snapshot} />
      </div>
    );
  }
  return (
    <figure className="capture" title="Red pixels are the changes pixelmatch found">
      <figcaption className="caption-row">
        <span className="pill">Diff</span>
      </figcaption>
      <div className="frame">
        <SnapshotImage src={imageUrl(imageHash)} alt="Current" />
        <SnapshotImage
          src={imageUrl(diffHash)}
          alt="Diff"
          className="overlay"
          style={{ opacity: opacity / 100 }}
        />
      </div>
    </figure>
  );
}

export function Slider({ snapshot }: ModeProps): ReactElement {
  const { baselineHash, imageHash } = snapshot;
  if (baselineHash === null || imageHash === null) {
    return (
      <div className="mode-fallback">
        <p className="muted">The slider needs both a baseline and a current image.</p>
        <SideBySide snapshot={snapshot} />
      </div>
    );
  }
  return <CompareSlider baselineSrc={imageUrl(baselineHash)} currentSrc={imageUrl(imageHash)} />;
}

export function Toggle({
  snapshot,
  shown,
}: ModeProps & { readonly shown: ImageKind }): ReactElement {
  return <ImagePane kind={shown} snapshot={snapshot} />;
}
