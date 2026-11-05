import type { Snapshot } from '@targus/core';
import type { ReactElement } from 'react';

import { imageUrl } from '../../api-client/index.js';
import { CompareSlider } from '../../components/CompareSlider.js';
import { ImagePane } from './ImagePane.js';
import type { ViewerState } from './useViewer.js';

interface ModeProps {
  readonly snapshot: Snapshot;
  readonly viewer: ViewerState;
}

function TwoUp({ snapshot, viewer }: ModeProps): ReactElement {
  const diffOpacity = viewer.diff ? viewer.opacity : null;
  return (
    <div className="two-up">
      <ImagePane kind="baseline" snapshot={snapshot} diffOpacity={null} />
      <ImagePane kind="current" snapshot={snapshot} diffOpacity={diffOpacity} />
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
      <CompareSlider baselineSrc={imageUrl(baselineHash)} currentSrc={imageUrl(imageHash)} />
    </div>
  );
}

/** The image area for the active mode. */
export function ViewerBody({ snapshot, viewer }: ModeProps): ReactElement {
  if (viewer.mode === 'one-up') return <OneUp snapshot={snapshot} viewer={viewer} />;
  if (viewer.mode === 'slider') return <Slider snapshot={snapshot} viewer={viewer} />;
  return <TwoUp snapshot={snapshot} viewer={viewer} />;
}
