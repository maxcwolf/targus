import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { StoryHistoryEntry } from '@targus/core/browser';
import type { ReactElement } from 'react';

import { getStoryHistory, imageUrl, queryKeys, type StoryRef } from '../../api-client/index.ts';
import { ReviewPill, StateBadge } from '../../components/Badges.tsx';
import { formatDateTime, shortSha } from '../../components/format.ts';
import { SnapshotImage } from '../../components/SnapshotImage.tsx';

export interface StoryHistoryProps {
  readonly projectId: string;
  readonly story: StoryRef;
  /** The snapshot on screen, marked in the list; absent where none is (the library). */
  readonly currentSnapshotId?: string | undefined;
}

/** Only a changed or new snapshot waits on a reviewer, so only those show a decision. */
function reviewed({ snapshot }: StoryHistoryEntry): boolean {
  return snapshot.state === 'changed' || snapshot.state === 'new';
}

function Entry(props: {
  readonly entry: StoryHistoryEntry;
  readonly current: boolean;
}): ReactElement {
  const { build, snapshot } = props.entry;
  return (
    <li>
      <Link
        to="/builds/$buildId/snapshots/$snapshotId"
        params={{ buildId: build.id, snapshotId: snapshot.id }}
        className={props.current ? 'history-entry current' : 'history-entry'}
        aria-current={props.current ? 'page' : undefined}
        aria-label={`Build ${String(build.number)} on ${build.branch}`}
      >
        <span className="history-thumb">
          {snapshot.imageHash === null ? null : (
            <SnapshotImage src={imageUrl(snapshot.imageHash)} alt="" />
          )}
        </span>
        <span className="history-build">
          <strong>Build {build.number}</strong>
          <span className="lighter">
            {build.branch} · {shortSha(build.sha)}
          </span>
        </span>
        <span className="history-badges">
          <StateBadge state={snapshot.state} />
          {reviewed(props.entry) ? <ReviewPill review={snapshot.review} /> : null}
        </span>
        <span className="history-date lighter">{formatDateTime(build.createdAt)}</span>
      </Link>
    </li>
  );
}

function Entries(props: {
  readonly entries: readonly StoryHistoryEntry[];
  readonly currentSnapshotId: string | undefined;
}): ReactElement {
  if (props.entries.length === 0) {
    return <p className="muted">No build has changed this story yet.</p>;
  }
  return (
    <ol className="history-list">
      {props.entries.map((entry) => (
        <Entry
          key={entry.snapshot.id}
          entry={entry}
          current={entry.snapshot.id === props.currentSnapshotId}
        />
      ))}
    </ol>
  );
}

/**
 * Where a story changed: every build of its platform in which it was new, changed, removed,
 * unstable or errored, on any branch, newest first. Each row opens that build's snapshot.
 */
export function StoryHistory({
  projectId,
  story,
  currentSnapshotId,
}: StoryHistoryProps): ReactElement {
  const { storyId, variant, platform } = story;
  const history = useQuery({
    queryKey: queryKeys.storyHistory(projectId, storyId, variant, platform),
    queryFn: () => getStoryHistory(projectId, { storyId, variant, platform }),
  });
  return (
    <section className="story-history" aria-label="History">
      <p className="section-label">History</p>
      {history.data ? (
        <Entries entries={history.data.entries} currentSnapshotId={currentSnapshotId} />
      ) : (
        <p className="muted">
          {history.isError ? 'Could not load the history of this story.' : 'Loading the history…'}
        </p>
      )}
    </section>
  );
}
