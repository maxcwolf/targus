import type { ReactElement } from 'react';

export interface SkeletonProps {
  /** Read out to screen readers (and found by tests) while the bars shimmer. */
  readonly label: string;
  readonly rows?: number;
  readonly variant?: 'rows' | 'viewer';
}

/** Grey shimmering placeholder bars shown while a page loads. */
export function Skeleton({ label, rows = 5, variant = 'rows' }: SkeletonProps): ReactElement {
  return (
    <div className={`skeleton skeleton-${variant}`} aria-busy="true">
      <span className="sr-only">{label}</span>
      {variant === 'viewer' ? (
        <>
          <div className="skeleton-bar skeleton-title" />
          <div className="skeleton-bar skeleton-toolbar" />
          <div className="skeleton-bar skeleton-pane" />
        </>
      ) : (
        Array.from({ length: rows }, (_, row) => (
          <div key={row} className="skeleton-bar skeleton-row" />
        ))
      )}
    </div>
  );
}
