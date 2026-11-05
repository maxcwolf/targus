import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import { approveAll } from '../../api-client/index.js';
import { ConfirmButton } from '../../components/ConfirmButton.js';
import { plural } from '../../components/format.js';
import { applyBuildUpdate } from './cache.js';

export interface ApproveAllProps {
  readonly buildId: string;
  readonly pendingCount: number;
  readonly disabled: boolean;
}

/** "Approve all" with an inline confirmation step. */
export function ApproveAll({ buildId, pendingCount, disabled }: ApproveAllProps): ReactElement {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => approveAll(buildId),
    onSuccess: (response) => applyBuildUpdate(queryClient, response),
  });
  return (
    <div className="approve-all">
      <ConfirmButton
        label="Approve all"
        confirmLabel={`Confirm: approve ${plural(pendingCount, 'change')}`}
        disabled={disabled || pendingCount === 0}
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
