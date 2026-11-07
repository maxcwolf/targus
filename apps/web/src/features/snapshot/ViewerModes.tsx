import type { Snapshot } from '@targus/core/browser';
import type { ReactElement } from 'react';

import { imageUrl } from '../../api-client/index.ts';
import { CompareSlider } from '../../components/CompareSlider.tsx';
import { ImagePane } from './ImagePane.tsx';
import type { ViewerState } from './useViewer.ts';

interface ModeProps {
  readonly snapshot: Snapshot;
  readonly viewer: ViewerState;
}

function TwoUp({ snapshot, viewer }: ModeProps): ReactElement {
  const diffOpacity = viewer.diff ? viewer.opacity : null;
  return (
    <div className="two-up">
      <ImagePane
        kind="baseline"
        snapshot={snapshot}
        diffOpacity={null}
        onImageLoad={viewer.onImageLoad}
      />
      <ImagePane
        kind="current"
        snapshot={snapshot}
        diffOpacity={diffOpacity}
        onImageLoad={viewer.onImageLoad}
      />
    </div>
  );
}

function OneUp({ snapshot, viewer }: ModeProps): ReactElement {
  return (
    <div className="one-up">
      <ImagePane
        kind={viewer.side}
        snapshot={snapshot}
        diffOpacity={viewer.diff ? viewer.opacity : null}
        onImageLoad={viewer.onImageLoad}
      />
    </div>
  );
}

function Slider({ snapshot, viewer }: ModeProps): ReactElement {
  const { baselineHash, imageHash } = snapshot;
  if (baselineHash === null || imageHash === null) {
    return (
      <div className="mode-fallback">
        <p className="muted">The slider needs both a baseline and a new image.</p>
        <TwoUp snapshot={snapshot} viewer={viewer} />
      </div>
    );
  }
  return (
    <div className="capture">
      <CompareSlider
        baselineSrc={imageUrl(baselineHash)}
        currentSrc={imageUrl(imageHash)}
        onImageLoad={viewer.onImageLoad}
      />
    </div>
  );
}

/** The image area for the active mode. */
export function ViewerBody({ snapshot, viewer }: ModeProps): ReactElement {
  if (viewer.mode === 'one-up') return <OneUp snapshot={snapshot} viewer={viewer} />;
  if (viewer.mode === 'slider') return <Slider snapshot={snapshot} viewer={viewer} />;
  return <TwoUp snapshot={snapshot} viewer={viewer} />;
}
