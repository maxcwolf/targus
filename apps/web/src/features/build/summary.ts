import type { BuildStatusSummary } from '@targus/core';

import { plural } from '../../components/format.js';

/** The one-line status under the build header. */
export function summaryLine(summary: BuildStatusSummary): string {
  const { pendingCount, deniedCount, errorCount } = summary;
  switch (summary.status) {
    case 'in_progress':
      return 'Capture in progress: snapshots are still uploading.';
    case 'pending':
      return `${plural(pendingCount, 'change')} awaiting review`;
    case 'denied':
      return pendingCount > 0
        ? `${plural(deniedCount, 'change')} denied, ${pendingCount} awaiting review`
        : `${plural(deniedCount, 'change')} denied`;
    case 'accepted':
      return 'All changes approved';
    case 'passed':
      return 'No visual changes';
    case 'failed':
      return errorCount === 1
        ? '1 story failed to render; a later build must fix it'
        : `${errorCount} stories failed to render; a later build must fix them`;
  }
}
