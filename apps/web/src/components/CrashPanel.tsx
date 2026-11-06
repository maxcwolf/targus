import type { ReactElement } from 'react';

export interface CrashPanelProps {
  readonly onReload: () => void;
}

/**
 * What the reviewer sees when a page fails to render: a plain message and a reload button.
 * Never the error's stack or message, which mean nothing to a reviewer.
 */
export function CrashPanel({ onReload }: CrashPanelProps): ReactElement {
  return (
    <section className="panel" role="alert">
      <h1>Something went wrong</h1>
      <p>This page stopped working. Reloading it usually helps; decisions already saved stay.</p>
      <button type="button" className="button primary" onClick={onReload}>
        Reload page
      </button>
    </section>
  );
}
