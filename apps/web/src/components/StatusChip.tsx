import type { BuildStatus } from '@targus/core';
import type { ReactElement } from 'react';

const labels: Record<BuildStatus, string> = {
  pending: 'Pending review',
  accepted: 'Accepted',
  denied: 'Denied',
  passed: 'Passed',
  failed: 'Failed',
  in_progress: 'In progress',
};

/** A build's status, coloured by the `--status-*` variables in styles.css. */
export function StatusChip({ status }: { readonly status: BuildStatus }): ReactElement {
  return (
    <span
      role="status"
      aria-label="Build status"
      className={`chip chip-${status}`}
      data-status={status}
    >
      {labels[status]}
    </span>
  );
}
