import type { ImageHash, Snapshot } from '../contracts/snapshot.js';

/**
 * The image the next build compares this story against (plan.md section 6, rule 5): the
 * captured image when it is unchanged or approved, otherwise the baseline it was compared with.
 * `null` for a removed story, or a new story nobody has approved yet. An `error` snapshot
 * keeps its baseline (ADR 0004, rule 6).
 */
export function acceptedImageHash(
  snapshot: Pick<Snapshot, 'imageHash' | 'baselineHash' | 'state' | 'review'>,
): ImageHash | null {
  if (snapshot.state === 'error') return snapshot.baselineHash;
  if (snapshot.state === 'unchanged' || snapshot.review === 'approved') return snapshot.imageHash;
  return snapshot.baselineHash;
}
