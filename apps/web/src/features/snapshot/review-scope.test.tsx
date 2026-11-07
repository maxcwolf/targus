import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { reviewSnapshot } from '../../api-client/index.ts';
import { apiError, apiState, server } from '../../test/msw.ts';
import { loadImages, renderApp } from '../../test/render.tsx';
import { reviewMutationKey, type ReviewVariables } from '../build/index.ts';

async function openSnapshot(path: string): Promise<ReturnType<typeof renderApp>> {
  const app = renderApp(path);
  await screen.findByRole('tablist', { name: 'Viewer mode' });
  return app;
}

const heading = (): HTMLElement => screen.getByRole('heading', { level: 1 });
const press = (key: string): void => {
  fireEvent.keyDown(window, { key });
};

/**
 * Hold every review request until `release()`, then answer 500 if `fail`, or at once with a 500
 * if `failDenies` and it is a deny. Resolving with nothing hands the request on to the in-memory
 * API's own handler. `requests()` counts the review requests made so far.
 */
function holdReviews(
  fail = false,
  failDenies = false,
): { release: () => void; requests: () => number } {
  let release = (): void => undefined;
  let requests = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.post('*/api/snapshots/:id/review', async ({ request }) => {
      requests += 1;
      const { decision } = (await request.clone().json()) as { decision: string };
      if (failDenies && decision === 'deny') return apiError(500, 'internal', 'Database is busy');
      await gate;
      return fail ? apiError(500, 'internal', 'Database is busy') : undefined;
    }),
  );
  return {
    release: () => {
      release();
    },
    requests: () => requests,
  };
}

/**
 * Deny a snapshot through the mutation cache, as `useReview` would, but past the page's guard
 * against a second decision in flight: what the guard prevents, so the cache must survive it.
 */
function denyPastTheGuard(queryClient: QueryClient, snapshotId: string): void {
  const mutation = queryClient
    .getMutationCache()
    .build<unknown, Error, ReviewVariables, unknown>(queryClient, {
      mutationKey: reviewMutationKey('build-12'),
      gcTime: Infinity,
      mutationFn: (variables) => reviewSnapshot(variables.snapshotId, variables.decision),
    });
  mutation.execute({ snapshotId, decision: 'deny' }).catch(() => undefined);
}

const failures = (): Promise<HTMLElement> =>
  screen.findByRole('alert', { name: 'Failed decisions' });
const reviewBadge = (): HTMLElement => screen.getByRole('status', { name: 'Review' });

describe('a decision that fails after the reviewer moved on', () => {
  it('is listed on the next snapshot, links back, and the story stays unreviewed', async () => {
    const held = holdReviews(true);
    await openSnapshot('/builds/build-12/snapshots/snap-new?filter=all');
    loadImages();
    press('a');
    press('j');
    await waitFor(() => {
      expect(heading()).toHaveTextContent('Button : Primary');
    });

    held.release();

    const notice = await failures();
    expect(notice).toHaveTextContent('Avatar / Large: Approve failed. Database is busy');
    expect(screen.queryByText('Approved Avatar / Large')).not.toBeInTheDocument();
    fireEvent.click(within(notice).getByRole('link', { name: 'Avatar / Large' }));
    await waitFor(() => {
      expect(heading()).toHaveTextContent('Avatar : Large');
    });
    expect(reviewBadge()).toHaveTextContent('Unreviewed');
    expect(await failures()).toHaveTextContent('Avatar / Large');
  });

  it('stays on the build page until dismissed', async () => {
    const held = holdReviews(true);
    const { router } = await openSnapshot('/builds/build-12/snapshots/snap-new?filter=all');
    loadImages();
    press('d');
    press('Escape');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/builds/build-12');
    });

    held.release();

    const notice = await failures();
    expect(notice).toHaveTextContent('Avatar / Large: Deny failed. Database is busy');
    fireEvent.click(within(notice).getByRole('button', { name: 'Dismiss Avatar / Large' }));
    await waitFor(() => {
      expect(notice).not.toBeInTheDocument();
    });
  });
});

describe('a failed decision decided again', () => {
  it('clears once the story is decided again and that decision is saved', async () => {
    server.use(
      http.post('*/api/snapshots/:id/review', () => apiError(409, 'conflict', 'Not reviewable'), {
        once: true,
      }),
    );
    await openSnapshot('/builds/build-12/snapshots/snap-new?filter=all');
    loadImages();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await failures()).toHaveTextContent('Avatar / Large: Approve failed. Not reviewable');

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Approved Avatar / Large')).toBeInTheDocument();
    expect(screen.queryByRole('alert', { name: 'Failed decisions' })).not.toBeInTheDocument();
    expect(reviewBadge()).toHaveTextContent('Approved');
  });
});

describe('review state belongs to its snapshot', () => {
  it('does not keep the next snapshot busy while the previous review is in flight', async () => {
    const held = holdReviews();
    await openSnapshot('/builds/build-12/snapshots/snap-new?filter=all');
    loadImages();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    });

    press('j');

    await waitFor(() => {
      expect(heading()).toHaveTextContent('Button : Primary');
    });
    loadImages();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    held.release();
    expect(await screen.findByText('Approved Avatar / Large')).toBeInTheDocument();
    expect(heading()).toHaveTextContent('Button : Primary');
  });
});

describe('a review in flight when the reviewer leaves', () => {
  it('does not pull the reviewer back once they have left the snapshot', async () => {
    const held = holdReviews();
    const { router } = await openSnapshot('/builds/build-12/snapshots/snap-new?filter=unreviewed');
    loadImages();
    press('a');
    press('Escape');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/builds/build-12');
    });

    held.release();

    await waitFor(() => {
      expect(apiState.snapshots.find((s) => s.id === 'snap-new')?.review).toBe('approved');
    });
    // Give the resolved review time to act on the router, as it would if it still could.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.state.location.pathname).toBe('/builds/build-12');
  });
});

describe('a second decision on a snapshot with one in flight', () => {
  it('is refused by the buttons and the keys, even after deciding another snapshot', async () => {
    const held = holdReviews();
    await openSnapshot('/builds/build-12/snapshots/snap-new?filter=all');
    loadImages();
    press('a');
    press('j');
    await waitFor(() => {
      expect(heading()).toHaveTextContent('Button : Primary');
    });
    loadImages();
    press('a');
    press('k');
    await waitFor(() => {
      expect(heading()).toHaveTextContent('Avatar : Large');
    });
    loadImages();

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    press('d');
    press('a');
    expect(held.requests()).toBe(2);

    held.release();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    });
    expect(held.requests()).toBe(2);
  });

  it('keeps a newer failure listed when an older decision then succeeds', async () => {
    const held = holdReviews(false, true);
    const { queryClient } = await openSnapshot('/builds/build-12/snapshots/snap-new?filter=all');
    loadImages();
    press('a');
    await waitFor(() => {
      expect(held.requests()).toBe(1);
    });
    denyPastTheGuard(queryClient, 'snap-new');
    expect(await failures()).toHaveTextContent('Avatar / Large: Deny failed. Database is busy');

    held.release();

    expect(await screen.findByText('Approved Avatar / Large')).toBeInTheDocument();
    expect(apiState.snapshots.find((s) => s.id === 'snap-new')?.review).toBe('approved');
    expect(await failures()).toHaveTextContent('Avatar / Large: Deny failed. Database is busy');
  });
});
