import { useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { Skeleton } from '../../components/Skeleton.js';
import { ErrorView } from '../errors/ErrorView.js';
import { BuildActions } from './BuildActions.js';
import { BuildCounters } from './BuildCounters.js';
import { BuildHeader } from './BuildHeader.js';
import { effectiveFilter, matchesFilter, type SnapshotFilter } from './filters.js';
import { ReviewProgress } from './ReviewProgress.js';
import { SnapshotTable } from './SnapshotTable.js';
import { useBuildData } from './useBuildData.js';

export interface BuildPageProps {
  readonly buildId: string;
  readonly filter: SnapshotFilter | undefined;
}

/** `/builds/$buildId`: Chromatic's build screen: header, info card, counters, the table. */
export function BuildPage({ buildId, filter }: BuildPageProps): ReactElement {
  const navigate = useNavigate();
  const data = useBuildData(buildId);
  if (data.status === 'pending') return <Skeleton label="Loading build…" rows={8} />;
  if (data.status === 'error') return <ErrorView error={data.error} />;

  const { build, snapshots, project } = data;
  const active = effectiveFilter(filter, snapshots);
  const shown = snapshots.filter((snapshot) => matchesFilter(snapshot, active));
  return (
    <section>
      <BuildHeader item={build} project={project} />
      <p className="section-label">Snapshots</p>
      <div className="card snapshots-card">
        <div className="toolbar">
          <BuildCounters
            snapshots={snapshots}
            active={active}
            onSelect={(id) => {
              void navigate({
                to: '/builds/$buildId',
                params: { buildId },
                search: { filter: id },
              });
            }}
          />
          <BuildActions
            buildId={buildId}
            pending={snapshots.filter((snapshot) => matchesFilter(snapshot, 'unreviewed'))}
            uploading={build.build.status === 'in_progress'}
          />
        </div>
        <ReviewProgress snapshots={snapshots} />
        <SnapshotTable buildId={buildId} snapshots={shown} filter={active} />
      </div>
    </section>
  );
}
