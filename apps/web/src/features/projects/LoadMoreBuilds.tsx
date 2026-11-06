import type { ReactElement } from 'react';

interface LoadMoreBuildsProps {
  /** True while the next page is being fetched. */
  readonly loading: boolean;
  /** Why the last attempt to fetch the next page failed, or null. */
  readonly error: Error | null;
  readonly onLoadMore: () => void;
}

/**
 * The control under the builds list that fetches the next, older page. While a page loads the
 * button stays focusable but inert (`aria-disabled`), so keyboard focus is not lost; a failure
 * is announced and the same button retries.
 */
export function LoadMoreBuilds({ loading, error, onLoadMore }: LoadMoreBuildsProps): ReactElement {
  const label = loading ? 'Loading more builds…' : 'Load more builds';
  return (
    <div className="load-more">
      {error === null ? null : (
        <p className="error-text" role="alert">
          Could not load more builds. {error.message}
        </p>
      )}
      <button
        type="button"
        className="button"
        aria-disabled={loading}
        aria-busy={loading}
        onClick={() => {
          if (!loading) onLoadMore();
        }}
      >
        {label}
      </button>
    </div>
  );
}
