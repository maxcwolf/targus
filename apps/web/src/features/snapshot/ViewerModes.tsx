import type { Snapshot } from '@targus/core/browser';
import { type ReactElement, useState } from 'react';

import { imageUrl } from '../../api-client/index.ts';
import { SplitControl } from '../../components/CompareSlider.tsx';
import { ImagePane } from './ImagePane.tsx';
import { Stage } from './Stage.tsx';
import { diffLayers, diffTitle } from './stage-layers.ts';
import { splitClip } from './stage-sizes.ts';
import type { ViewerState } from './useViewer.ts';

interface ModeProps {
  readonly snapshot: Snapshot;
  readonly viewer: ViewerState;
}

function TwoUp({ snapshot, viewer }: ModeProps): ReactElement {
  return (
    <div className="two-up">
      <ImagePane kind="baseline" snapshot={snapshot} viewer={viewer} />
      <ImagePane kind="current" snapshot={snapshot} viewer={viewer} />
    </div>
  );
}

function OneUp({ snapshot, viewer }: ModeProps): ReactElement {
  return (
    <div className="one-up">
      <ImagePane kind={viewer.side} snapshot={snapshot} viewer={viewer} />
    </div>
  );
}

/**
 * Both captures on one canvas, cut at the split: left of the line is the baseline, right of it
 * the new capture. With Diff on, the changes are marked on both.
 */
function Slider({ snapshot, viewer }: ModeProps): ReactElement {
  const [position, setPosition] = useState(50);
  const { baselineHash, imageHash } = snapshot;
  if (baselineHash === null || imageHash === null) {
    return (
      <div className="mode-fallback">
        <p className="muted">The slider needs both a baseline and a new image.</p>
        <TwoUp snapshot={snapshot} viewer={viewer} />
      </div>
    );
  }
  const { baseline, current, canvas } = viewer.stage;
  // The diff covers the whole canvas, on both sides of the split.
  const overlay = diffLayers(snapshot, viewer);
  const clip = (side: 'baseline' | 'current', size: typeof baseline) => ({
    clipPath: splitClip(side, position, size, canvas),
  });
  return (
    <div className="capture compare-slider">
      <Stage
        canvas={canvas}
        layers={[
          { src: imageUrl(imageHash), alt: 'New', size: current, style: clip('current', current) },
          {
            src: imageUrl(baselineHash),
            alt: 'Baseline',
            size: baseline,
            style: clip('baseline', baseline),
          },
          ...overlay,
        ]}
        onImageLoad={viewer.onImageLoad}
        title={overlay.length > 0 ? diffTitle : undefined}
      >
        <SplitControl position={position} onChange={setPosition} />
      </Stage>
    </div>
  );
}

/** The image area for the active mode. */
export function ViewerBody({ snapshot, viewer }: ModeProps): ReactElement {
  if (viewer.mode === 'one-up') return <OneUp snapshot={snapshot} viewer={viewer} />;
  if (viewer.mode === 'slider') return <Slider snapshot={snapshot} viewer={viewer} />;
  return <TwoUp snapshot={snapshot} viewer={viewer} />;
}
