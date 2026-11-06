import type { SnapshotState } from '@targus/core/browser';
import type { ReactElement } from 'react';

const notices: Partial<Record<SnapshotState, string>> = {
  error:
    'This story failed to render in this build, so there is nothing to approve. A later build ' +
    'that captures it will clear the error.',
  removed: 'The baseline has this story and this build does not. Nothing to review.',
  unstable: 'Captures of this story differed between attempts. Unstable stories never block.',
  unchanged: 'Matches the baseline. Nothing to review.',
};

/** Why a non-reviewable snapshot has no Approve/Deny. */
export function StateNotice({ state }: { readonly state: SnapshotState }): ReactElement | null {
  const text = notices[state];
  if (!text) return null;
  return <p className={`notice notice-${state}`}>{text}</p>;
}
