import { useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { Skeleton } from '../../components/Skeleton.tsx';
import { ErrorView } from '../errors/index.ts';
import { BuildActions } from './BuildActions.tsx';
import { BuildCounters } from './BuildCounters.tsx';
import { BuildHeader } from './BuildHeader.tsx';
import { effectiveFilter, matchesFilter, type SnapshotFilter } from './filters.ts';
import { ReviewProgress } from './ReviewProgress.tsx';
import { SnapshotTable } from './SnapshotTable.tsx';
import { useBuildData } from './useBuildData.ts';

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
