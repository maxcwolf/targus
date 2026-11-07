import type { ImageHash } from '../contracts/snapshot.ts';
import type { StoryResult } from '../contracts/submit-results.ts';

/** The diff of one story that may be stored with, and classified against, its baseline. */
export interface PinnedDiff {
  readonly diffRatio: number | null;
  readonly diffHash: ImageHash | null;
  /**
   * The CLI diffed against another baseline than the one the server compares with, because the
   * baseline build was reviewed while the run was open, so its diff was dropped.
   */
  readonly baselineMoved: boolean;
}

/**
 * The CLI's diff of a story, kept only when it was measured against `baselineHash`, the
 * baseline the server compares the story with at submit (ADR 0032). A stored snapshot's state,
 * diff ratio and diff image therefore always refer to its stored baseline.
 *
 * When the baseline moved, the diff belongs to another image, so it is dropped: the ratio is 0
 * when the capture is the new baseline itself (identical images), and null otherwise, so that
 * `compareSnapshot` classifies by hash alone and a different capture is `changed`. The server
 * cannot measure the ratio itself (ADR 0003), so such a story is reviewed without a diff image.
 */
export function pinnedDiff(
  result: Pick<StoryResult, 'imageHash' | 'baselineHash' | 'diffRatio' | 'diffHash'>,
  baselineHash: ImageHash | null,
): PinnedDiff {
  if (result.baselineHash === baselineHash) {
    return { diffRatio: result.diffRatio, diffHash: result.diffHash, baselineMoved: false };
  }
  const identical = baselineHash !== null && result.imageHash === baselineHash;
  return { diffRatio: identical ? 0 : null, diffHash: null, baselineMoved: true };
}
