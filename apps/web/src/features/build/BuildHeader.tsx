import type { BuildWithSummary, ProjectSummary } from '@targus/core';
import type { ReactElement, ReactNode } from 'react';

import {
  changeCount,
  commitUrl,
  formatDateTime,
  pullRequestUrl,
  shortSha,
  storyCount,
} from '../../components/format.ts';
import { StatusChip } from '../../components/StatusChip.tsx';
import { StatusCircle } from '../../components/StatusCircle.tsx';
import { summaryLine } from './summary.ts';

export interface BuildHeaderProps {
  readonly item: BuildWithSummary;
  readonly project: ProjectSummary | undefined;
}

function Stat({ value, caption }: { readonly value: number; readonly caption: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-caption">{caption}</span>
    </div>
  );
}

function InfoCell({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="info-cell">
      <span className="info-label">{label}</span>
      <span className="info-value">{children}</span>
    </div>
  );
}

function InfoCard({ item, project }: BuildHeaderProps): ReactElement {
  const { build, counts } = item;
  const repo = project?.repo;
  return (
    <div className="card info-card">
      <InfoCell label="Stories">{storyCount(counts)}</InfoCell>
      <InfoCell label="Changes">{changeCount(counts)}</InfoCell>
      <InfoCell label="Device">{build.device}</InfoCell>
      <InfoCell label="PR">
        {repo && build.prNumber !== null ? (
          <a href={pullRequestUrl(repo, build.prNumber)}>PR #{build.prNumber}</a>
        ) : null}
        <span className="mono">{build.branch}</span>
      </InfoCell>
      <InfoCell label="Commit">
        {repo ? (
          <a className="mono" href={commitUrl(repo, build.sha)}>
            {shortSha(build.sha)}
          </a>
        ) : (
          <span className="mono">{shortSha(build.sha)}</span>
        )}
      </InfoCell>
      <InfoCell label="Baseline">
        <span className="mono">{build.baselineBuildId?.slice(0, 8) ?? 'none'}</span>
      </InfoCell>
    </div>
  );
}

/** Status circle, build number, when and where it ran, the big stats, and the info card. */
export function BuildHeader({ item, project }: BuildHeaderProps): ReactElement {
  const { build, summary, counts } = item;
  return (
    <>
      <div className="build-header">
        <StatusCircle status={summary.status} size={44} />
        <div className="build-heading">
          <h1 className="build-number">
            Build {build.number} <StatusChip status={summary.status} />
          </h1>
          <p className="subline">
            Started {formatDateTime(build.createdAt)} · {build.device}
          </p>
          <p className="summary-line">{summaryLine(summary)}</p>
        </div>
        <div className="stats">
          <Stat value={changeCount(counts)} caption="Changes" />
          <Stat value={storyCount(counts)} caption="Stories" />
        </div>
      </div>
      <InfoCard item={item} project={project} />
    </>
  );
}
