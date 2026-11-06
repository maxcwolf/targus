import type { LibraryStory } from '../contracts/library.js';
import type { Snapshot } from '../contracts/snapshot.js';
import { acceptedImageHash } from './accepted-image-hash.js';

/**
 * The stories a build contributes to the library: each one that still exists, with its accepted
 * image (plan.md section 6, rule 5). A `removed` story is gone, and a story without an accepted
 * image (a new one nobody approved, or one that errored with no baseline) has nothing to show.
 */
export function libraryStories(snapshots: readonly Snapshot[]): LibraryStory[] {
  return snapshots.flatMap((snapshot) => {
    const imageHash = snapshot.state === 'removed' ? null : acceptedImageHash(snapshot);
    if (imageHash === null) return [];
    const { storyId, variant, title, name } = snapshot;
    return [{ storyId, variant, title, name, imageHash }];
  });
}
