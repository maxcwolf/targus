import type { Snapshot } from '@targus/core';
import type { ReactElement } from 'react';

import { imageUrl } from '../../api-client/index.js';
import { SnapshotImage } from '../../components/SnapshotImage.js';
import type { ImageKind } from './useViewer.js';

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
  /** Lay the pixelmatch diff over the new capture at this opacity (0..100); null for none. */
  readonly diffOpacity: number | null;
}

/** One capture on a white card, optionally with the diff over it, or why it is missing. */
export function ImagePane({ kind, snapshot, diffOpacity }: ImagePaneProps): ReactElement {
  const hash = kind === 'baseline' ? snapshot.baselineHash : snapshot.imageHash;
  if (hash === null) {
    return (
      <div className="capture">
        <div className="missing">{missingText(kind, snapshot)}</div>
      </div>
    );
  }
  const diffHash = kind === 'current' && diffOpacity !== null ? snapshot.diffHash : null;
  return (
    <div className="capture">
      <div
        className="frame"
        title={diffHash ? 'Red pixels are the changes pixelmatch found' : undefined}
      >
        <SnapshotImage src={imageUrl(hash)} alt={titles[kind]} />
        {diffHash ? (
          <SnapshotImage
            src={imageUrl(diffHash)}
            alt="Diff"
            className="overlay"
            style={{ opacity: (diffOpacity ?? 100) / 100 }}
          />
        ) : null}
      </div>
    </div>
  );
}
