import type { ReactElement, ReactNode } from 'react';

import {
  isSessionExpired,
  SessionExpired,
  SessionExpiredContext,
  useMe,
} from '../features/auth/index.ts';
import { ErrorView } from '../features/errors/index.ts';

/**
 * Renders the page only for a reviewer who has signed in; otherwise the sign-in panel. When the
 * session expires mid-visit the page stays and a "signed out" notice sits above it.
 */
export function AuthGate({ children }: { readonly children: ReactNode }): ReactElement | null {
  const me = useMe();
  if (me.isPending) return null;
  if (me.isError && me.data === undefined) return <ErrorView error={me.error} />;
  const expired = isSessionExpired(me);
  // The notice's slot is always there (null or not), so the page below never remounts and
  // keeps the state of the action that failed.
  return (
    <SessionExpiredContext value={expired}>
      {expired ? <SessionExpired /> : null}
      {children}
    </SessionExpiredContext>
  );
}
