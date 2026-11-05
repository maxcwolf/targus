import type { ReactElement, ReactNode } from 'react';

import { ErrorView } from '../errors/ErrorView.js';
import { useMe } from './useMe.js';

/** Renders the page only for a signed-in reviewer; otherwise the sign-in panel. */
export function AuthGate({ children }: { readonly children: ReactNode }): ReactElement | null {
  const me = useMe();
  if (me.isPending) return null;
  if (me.isError) return <ErrorView error={me.error} />;
  return <>{children}</>;
}
