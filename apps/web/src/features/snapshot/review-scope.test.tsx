import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { apiError, apiState, server } from '../../test/msw.ts';
import { loadImages, renderApp } from '../../test/render.tsx';

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
 * Hold every review request until `release()`. Resolving with nothing hands the request on to the
 * in-memory API's own handler.
 */
function holdReviews(): { release: () => void } {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.post('*/api/snapshots/:id/review', async () => {
      await gate;
    }),
  );
  return {
    release: () => {
      release();
    },
  };
}

describe('review state belongs to its snapshot', () => {
  it('does not show the previous snapshot’s review error on the next one', async () => {
    server.use(
      http.post('*/api/snapshots/:id/review', () => apiError(409, 'conflict', 'Not reviewable')),
    );
    await openSnapshot('/builds/build-12/snapshots/snap-new?filter=all');
    loadImages();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not reviewable');

    press('j');

    await waitFor(() => {
      expect(heading()).toHaveTextContent('Button : Primary');
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

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
