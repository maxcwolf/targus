import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { hash } from '../../test/fixtures.js';
import { apiError, apiState, server } from '../../test/msw.js';
import { renderApp } from '../../test/render.js';

const img = (digit: string): string => `/api/images/${hash(digit)}`;

async function openSnapshot(path: string): Promise<ReturnType<typeof renderApp>> {
  const app = renderApp(path);
  await screen.findByRole('tablist', { name: 'Viewer mode' });
  return app;
}

function selectMode(name: string): void {
  fireEvent.click(screen.getByRole('tab', { name }));
}

describe('SnapshotPage viewer', () => {
  it('renders every viewer mode with the right images', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed');

    expect(screen.getByRole('heading', { name: 'Button / Primary' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Baseline' })).toHaveAttribute('src', img('3'));
    expect(screen.getByRole('img', { name: 'Current' })).toHaveAttribute('src', img('2'));
    expect(screen.getByRole('img', { name: 'Current' })).toHaveAttribute('loading', 'lazy');

    selectMode('Diff');
    expect(screen.getByRole('img', { name: 'Diff' })).toHaveAttribute('src', img('4'));
    expect(screen.getByRole('img', { name: 'Current' })).toHaveAttribute('src', img('2'));
    fireEvent.change(screen.getByRole('slider', { name: 'Diff opacity' }), {
      target: { value: '25' },
    });
    expect(screen.getByRole('img', { name: 'Diff' })).toHaveStyle({ opacity: '0.25' });

    selectMode('Slider');
    const baseline = screen.getByRole('img', { name: 'Baseline' });
    expect(baseline).toHaveAttribute('src', img('3'));
    fireEvent.change(screen.getByRole('slider', { name: 'Reveal baseline' }), {
      target: { value: '30' },
    });
    expect(baseline.style.clipPath).toBe('inset(0 70% 0 0)');

    selectMode('Toggle');
    expect(screen.getByRole('img', { name: 'Current' })).toHaveAttribute('src', img('2'));
    expect(screen.queryByRole('img', { name: 'Baseline' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Baseline' }));
    expect(screen.getByRole('img', { name: 'Baseline' })).toHaveAttribute('src', img('3'));
    expect(screen.queryByRole('img', { name: 'Current' })).not.toBeInTheDocument();
  });
});

describe('SnapshotPage zoom and missing images', () => {
  it('toggles zoom between fit and 100%', async () => {
    const { container } = await openSnapshot('/builds/build-12/snapshots/snap-changed');

    expect(container.querySelector('.viewer-pane')).toHaveAttribute('data-zoom', 'fit');
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(container.querySelector('.viewer-pane')).toHaveAttribute('data-zoom', 'actual');
    expect(screen.getByRole('button', { name: '100%' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(container.querySelector('.viewer-pane')).toHaveAttribute('data-zoom', 'fit');
  });

  it('shows "No baseline" for a new story and falls back where modes need both images', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-new');

    expect(screen.getByText('No baseline: this story is new.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Current' })).toHaveAttribute('src', img('1'));
    selectMode('Diff');
    expect(screen.getByText('No diff image for a new snapshot.')).toBeInTheDocument();
    selectMode('Slider');
    expect(screen.getByText(/needs both a baseline and a current image/)).toBeInTheDocument();
  });

  it('shows no current image for a removed story, and no review buttons that work', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-removed?filter=removed');

    expect(screen.getByText('No current image: this story was removed.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Baseline' })).toHaveAttribute('src', img('8'));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
  });
});

describe('SnapshotPage non-reviewable states', () => {
  it('explains an errored story and disables review', async () => {
    await openSnapshot('/builds/build-11/snapshots/snap-error');

    expect(screen.getByText(/failed to render in this build/)).toBeInTheDocument();
    expect(screen.getByText('No current image: the story failed to render.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'a' });
    expect(apiState.calls).toEqual([]);
  });

  it('marks an unstable story as never blocking and not reviewable', async () => {
    await openSnapshot('/builds/build-11/snapshots/snap-unstable');

    expect(screen.getByText(/never block/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('shows not found for a snapshot the build does not have', async () => {
    renderApp('/builds/build-12/snapshots/nope');

    expect(await screen.findByText('This build has no such snapshot.')).toBeInTheDocument();
  });
});

describe('SnapshotPage review', () => {
  it('approves, then reverses to deny, updating the badges and build cache', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed?filter=unreviewed');
    const review = screen.getByRole('status', { name: 'Review' });
    expect(review).toHaveTextContent('Pending');

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(review).toHaveTextContent('Approved');
    });
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/by octocat on/)).toBeInTheDocument();
    // The buttons stay disabled until the refetch after a decision settles.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Review' })).toHaveTextContent('Denied');
    });
    expect(screen.getByRole('button', { name: 'Deny' })).toHaveAttribute('aria-pressed', 'true');
    expect(apiState.calls).toEqual([
      'POST /api/snapshots/snap-changed/review',
      'POST /api/snapshots/snap-changed/review',
    ]);
    // The reviewed snapshot stays in the list it was opened from, so neighbours stay put.
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
  });

  it('approves and denies with the a and d keys', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-new?filter=all');

    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Review' })).toHaveTextContent('Approved');
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    });
    fireEvent.keyDown(window, { key: 'd' });
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Review' })).toHaveTextContent('Denied');
    });
  });

  it('shows the API error when a decision is rejected', async () => {
    server.use(
      http.post('*/api/snapshots/:id/review', () => apiError(409, 'conflict', 'Not reviewable')),
    );
    await openSnapshot('/builds/build-12/snapshots/snap-new');

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not reviewable');
  });
});

describe('SnapshotPage navigation', () => {
  it('moves with j and k through the filtered snapshots, keeping the filter', async () => {
    const { router } = await openSnapshot('/builds/build-12/snapshots/snap-new?filter=all');
    expect(screen.getByText('1 of 5')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Build #12' })).toHaveAttribute(
      'href',
      '/builds/build-12?filter=all',
    );

    fireEvent.keyDown(window, { key: 'j' });
    expect(await screen.findByRole('heading', { name: 'Button / Primary' })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ filter: 'all' });
    fireEvent.keyDown(window, { key: 'j' });
    expect(await screen.findByRole('heading', { name: 'Card / Default' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k' });
    expect(await screen.findByRole('heading', { name: 'Button / Primary' })).toBeInTheDocument();
  });

  it('links previous and next, and does nothing past the ends', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-new?filter=unreviewed');

    const nav = screen.getByRole('navigation', { name: 'Snapshots' });
    expect(within(nav).queryByRole('link', { name: 'Previous' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/builds/build-12/snapshots/snap-changed?filter=unreviewed',
    );
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByRole('heading', { name: 'Avatar / Large' })).toBeInTheDocument();
  });

  it('ignores shortcuts while an input has focus or with a modifier', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed?filter=all');
    selectMode('Diff');
    const slider = screen.getByRole('slider', { name: 'Diff opacity' });

    fireEvent.keyDown(slider, { key: 'j' });
    fireEvent.keyDown(slider, { key: 'a' });
    fireEvent.keyDown(window, { key: 'a', metaKey: true });
    fireEvent.keyDown(window, { key: 'x' });

    expect(screen.getByRole('heading', { name: 'Button / Primary' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Review' })).toHaveTextContent('Pending');
    expect(apiState.calls).toEqual([]);
  });
});
