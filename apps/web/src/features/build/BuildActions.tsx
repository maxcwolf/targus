import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Snapshot } from '@targus/core';
import type { ReactElement } from 'react';

import { approveAll } from '../../api-client/index.js';
import { ConfirmButton } from '../../components/ConfirmButton.js';
import { plural } from '../../components/format.js';
import { applyBuildUpdate } from './cache.js';

export interface BuildActionsProps {
  readonly buildId: string;
  /** The changes still waiting for a decision, in build order. */
  readonly pending: readonly Snapshot[];
  /** True while the build is still uploading: nothing can be approved yet. */
  readonly uploading: boolean;
}

/** The primary action: opens the first unreviewed change in the snapshot viewer. */
function VerifyChanges({
  buildId,
  first,
}: {
  readonly buildId: string;
  readonly first: Snapshot | undefined;
}): ReactElement {
  if (!first) {
    return (
      <button type="button" className="button primary" disabled>
        Verify changes
      </button>
    );
  }
  return (
    <Link
      to="/builds/$buildId/snapshots/$snapshotId"
      params={{ buildId, snapshotId: first.id }}
      search={{ filter: 'unreviewed' }}
      className="button primary"
    >
      Verify changes
    </Link>
  );
}

/**
 * Chromatic's pair of build actions: "Verify changes" walks the reviewer through the unreviewed
 * changes one by one, "Batch" approves all of them at once after an inline confirmation.
 */
export function BuildActions({ buildId, pending, uploading }: BuildActionsProps): ReactElement {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => approveAll(buildId),
    onSuccess: (response) => applyBuildUpdate(queryClient, response),
  });
  return (
    <div className="build-actions">
      <VerifyChanges buildId={buildId} first={pending[0]} />
      <ConfirmButton
        label="Batch"
        title="Approve every unreviewed change at once"
        confirmLabel={`Confirm: approve ${plural(pending.length, 'change')}`}
        variant="secondary"
        disabled={uploading || pending.length === 0}
        busy={mutation.isPending}
        onConfirm={() => {
          mutation.mutate();
        }}
      />
      {mutation.isError ? (
        <span role="alert" className="error-text">
          {mutation.error.message}
        </span>
      ) : null}
    </div>
  );
}
