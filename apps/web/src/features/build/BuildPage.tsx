import { useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { Tabs } from '../../components/Tabs.js';
import { ErrorView } from '../errors/ErrorView.js';
import { ApproveAll } from './ApproveAll.js';
import { BuildHeader } from './BuildHeader.js';
import {
  effectiveFilter,
  filterTabs,
  matchesFilter,
  pendingReviewCount,
  type SnapshotFilter,
} from './filters.js';
import { SnapshotList } from './SnapshotList.js';
import { useBuildData } from './useBuildData.js';

export interface BuildPageProps {
  readonly buildId: string;
  readonly filter: SnapshotFilter | undefined;
}

/** `/builds/$buildId`: the build's snapshots, filtered and grouped, with "Approve all". */
export function BuildPage({ buildId, filter }: BuildPageProps): ReactElement {
  const navigate = useNavigate();
  const data = useBuildData(buildId);
  if (data.status === 'pending') return <p className="muted">Loading build…</p>;
  if (data.status === 'error') return <ErrorView error={data.error} />;

  const { build, snapshots, project } = data;
  const active = effectiveFilter(filter, snapshots);
  const shown = snapshots.filter((snapshot) => matchesFilter(snapshot, active));
  return (
    <section>
      <BuildHeader item={build} project={project} />
      <div className="toolbar">
        <Tabs
          label="Filter snapshots"
          items={filterTabs(snapshots)}
          active={active}
          onSelect={(id) => {
            void navigate({ to: '/builds/$buildId', params: { buildId }, search: { filter: id } });
          }}
        />
        <ApproveAll
          buildId={buildId}
          pendingCount={pendingReviewCount(snapshots)}
          disabled={build.build.status === 'in_progress'}
        />
      </div>
      <SnapshotList buildId={buildId} snapshots={shown} filter={active} />
    </section>
  );
}
