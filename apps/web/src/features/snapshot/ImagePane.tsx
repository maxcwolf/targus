import type { Snapshot } from '@targus/core/browser';
import type { ReactElement } from 'react';

import { imageUrl } from '../../api-client/index.ts';
import { Stage, type StageLayer } from './Stage.tsx';
import { diffLayers, diffTitle } from './stage-layers.ts';
import type { ImageKind, ViewerState } from './useViewer.ts';

const titles: Record<ImageKind, string> = { baseline: 'Baseline', current: 'New' };

function missingText(kind: ImageKind, snapshot: Snapshot): string {
  if (kind === 'baseline') {
    return snapshot.state === 'new' ? 'No baseline: this story is new.' : 'No baseline';
  }
  if (snapshot.state === 'removed') return 'No new image: this story was removed.';
  if (snapshot.state === 'error') return 'No new image: the story failed to render.';
  return 'No new image';
}

export interface ImagePaneProps {
  readonly kind: ImageKind;
  readonly snapshot: Snapshot;
  readonly viewer: ViewerState;
}

/** One capture on a white card, the changed pixels highlighted over the new one, or why it is missing. */
export function ImagePane({ kind, snapshot, viewer }: ImagePaneProps): ReactElement {
  const hash = kind === 'baseline' ? snapshot.baselineHash : snapshot.imageHash;
  if (hash === null) {
    return (
      <div className="capture">
        <div className="missing">{missingText(kind, snapshot)}</div>
      </div>
    );
  }
  const overlay = kind === 'current' ? diffLayers(snapshot, viewer) : [];
  const layers: StageLayer[] = [
    { src: imageUrl(hash), alt: titles[kind], size: viewer.stage[kind] },
    ...overlay,
  ];
  return (
    <div className="capture">
      <Stage
        canvas={viewer.stage.canvas}
        layers={layers}
        onImageLoad={viewer.onImageLoad}
        title={overlay.length > 0 ? diffTitle : undefined}
      />
    </div>
  );
}
