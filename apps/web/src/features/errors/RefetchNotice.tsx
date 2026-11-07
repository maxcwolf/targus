import type { ReactElement } from 'react';

/**
 * A page whose data loaded once and whose refetch (after a decision, on window focus) failed:
 * the page keeps what it has and this line says it may be out of date. Nothing when `error` is
 * null. The refetch error is kept until a later refetch succeeds.
 */
export function RefetchNotice({ error }: { readonly error: Error | null }): ReactElement | null {
  if (error === null) return null;
  return (
    <p className="notice notice-error" role="status">
      Could not refresh this page, so it may be out of date: {error.message}
    </p>
  );
}
