import type { Snapshot } from '@targus/core';
import type { ReactElement } from 'react';

import { imageUrl } from '../../api-client/index.js';
import { SnapshotImage } from '../../components/SnapshotImage.js';

export type ImageKind = 'baseline' | 'current';

const titles: Record<ImageKind, string> = { baseline: 'Baseline', current: 'Current' };

function missingText(kind: ImageKind, snapshot: Snapshot): string {
  if (kind === 'baseline') {
    return snapshot.state === 'new' ? 'No baseline: this story is new.' : 'No baseline';
  }
  if (snapshot.state === 'removed') return 'No current image: this story was removed.';
  if (snapshot.state === 'error') return 'No current image: the story failed to render.';
  return 'No current image';
}

export function imageHash(kind: ImageKind, snapshot: Snapshot): string | null {
  return kind === 'baseline' ? snapshot.baselineHash : snapshot.imageHash;
}

/** One captioned image, or the reason it is missing. */
export function ImagePane({
  kind,
  snapshot,
}: {
  readonly kind: ImageKind;
  readonly snapshot: Snapshot;
}): ReactElement {
  const hash = imageHash(kind, snapshot);
  return (
    <figure className="pane">
      <figcaption>{titles[kind]}</figcaption>
      {hash === null ? (
        <div className="missing">{missingText(kind, snapshot)}</div>
      ) : (
        <div className="checkerboard">
          <SnapshotImage src={imageUrl(hash)} alt={titles[kind]} />
        </div>
      )}
    </figure>
  );
}
