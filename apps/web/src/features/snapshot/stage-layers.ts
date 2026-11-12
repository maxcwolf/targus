import type { Snapshot } from '@targus/core/browser';

import { imageUrl } from '../../api-client/index.ts';
import type { StageLayer } from './Stage.tsx';
import type { ViewerState } from './useViewer.ts';

/**
 * The diff of a snapshot as a layer over its new capture, drawn in the viewer's diff style at its
 * opacity; none while Diff is off or the snapshot has no diff.
 */
export function diffLayers(snapshot: Snapshot, viewer: ViewerState): readonly StageLayer[] {
  if (!viewer.diff || snapshot.diffHash === null) return [];
  return [
    {
      src: imageUrl(snapshot.diffHash),
      alt: 'Diff',
      size: viewer.stage.diff,
      className: `diff-layer diff-${viewer.diffStyle}`,
      style: { opacity: viewer.opacity / 100 },
    },
  ];
}

/** The tooltip of a comparison that has the diff over it. */
export const diffTitle = 'The marked pixels are the changes pixelmatch found';
