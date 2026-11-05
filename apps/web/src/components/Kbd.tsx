import type { ReactElement } from 'react';

/** A keyboard shortcut hint inside a button or link; hidden from the accessible name. */
export function Kbd({ children }: { readonly children: string }): ReactElement {
  return <kbd aria-hidden="true">{children}</kbd>;
}
