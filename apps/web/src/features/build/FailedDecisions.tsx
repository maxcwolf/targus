import { Link } from '@tanstack/react-router';
import type { Snapshot } from '@targus/core/browser';
import type { ReactElement } from 'react';

import { useFailedDecisions } from './decisions.ts';
import { componentTitle, storyName } from './filters.ts';

export interface FailedDecisionsProps {
  readonly buildId: string;
  readonly snapshots: readonly Snapshot[];
}

function label(snapshots: readonly Snapshot[], snapshotId: string): string {
  const snapshot = snapshots.find((candidate) => candidate.id === snapshotId);
  return snapshot ? `${componentTitle(snapshot)} / ${storyName(snapshot)}` : snapshotId;
}

/**
 * Every approve or deny in this build that the API rejected, on the build page and on every
 * snapshot page, so a failure is seen even after the reviewer has moved on. Each names its
 * story and links to it; it stays until dismissed or until that story is decided again. The
 * story itself still reads as before the decision, since only a success updates the cache.
 */
export function FailedDecisions({ buildId, snapshots }: FailedDecisionsProps): ReactElement | null {
  const { failures, dismiss } = useFailedDecisions(buildId);
  if (failures.length === 0) return null;
  return (
    <div
      className="notice notice-error failed-decisions"
      role="alert"
      aria-label="Failed decisions"
    >
      <p>
        <strong>Decisions not saved.</strong> These stories keep their previous review:
      </p>
      <ul>
        {failures.map(({ snapshotId, decision, error }) => {
          const story = label(snapshots, snapshotId);
          return (
            <li key={snapshotId}>
              <Link
                to="/builds/$buildId/snapshots/$snapshotId"
                params={{ buildId, snapshotId }}
                search={{ filter: 'all' }}
              >
                {story}
              </Link>
              : {decision === 'approve' ? 'Approve' : 'Deny'} failed. {error.message}{' '}
              <button
                type="button"
                className="button small"
                aria-label={`Dismiss ${story}`}
                onClick={() => {
                  dismiss(snapshotId);
                }}
              >
                Dismiss
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
