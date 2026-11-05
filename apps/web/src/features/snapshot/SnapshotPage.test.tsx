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

describe('SnapshotPage header', () => {
  it('shows the title, build line, badges, back link and the baseline line', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed?filter=all');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Button : Primary');
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('title', 'Button : Primary');
    expect(document.querySelector('.snapshot-bar .subline')).toHaveTextContent(
      'Build 12 on feature/buttons · iPhone 16 / iOS 18.2',
    );
    expect(screen.getByRole('status', { name: 'Review' })).toHaveTextContent('Unreviewed');
    expect(screen.getByRole('link', { name: 'Back to build 12' })).toHaveAttribute(
      'href',
      '/builds/build-12?filter=all',
    );
    expect(await screen.findByText('Compared with build 11 (1234567)')).toBeInTheDocument();
    expect(screen.getByText('Build 11 on main')).toBeInTheDocument();
    expect(screen.getByText('Build 12 on feature/buttons')).toBeInTheDocument();
  });

  it('says there is no baseline for a first build', async () => {
    await openSnapshot('/builds/build-11/snapshots/snap-unstable');

    expect(screen.getByText('No baseline: first build on this branch')).toBeInTheDocument();
  });

  it('shows not found for a snapshot the build does not have', async () => {
    renderApp('/builds/build-12/snapshots/nope');

    expect(await screen.findByText('This build has no such snapshot.')).toBeInTheDocument();
  });
});

describe('SnapshotPage viewer modes', () => {
  it('shows 2 up, 1 up with its Baseline/New switch, and the slider', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed');

    expect(screen.getByRole('tab', { name: '2 up' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('img', { name: 'Baseline' })).toHaveAttribute('src', img('3'));
    expect(screen.getByRole('img', { name: 'New' })).toHaveAttribute('src', img('2'));
    expect(screen.getByRole('img', { name: 'New' })).toHaveAttribute('loading', 'lazy');

    selectMode('1 up');
    expect(screen.getByRole('img', { name: 'New' })).toHaveAttribute('src', img('2'));
    expect(screen.queryByRole('img', { name: 'Baseline' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Baseline' }));
    expect(screen.getByRole('img', { name: 'Baseline' })).toHaveAttribute('src', img('3'));
    expect(screen.queryByRole('img', { name: 'New' })).not.toBeInTheDocument();

    selectMode('Slider');
    const baseline = screen.getByRole('img', { name: 'Baseline' });
    fireEvent.change(screen.getByRole('slider', { name: 'Reveal baseline' }), {
      target: { value: '30' },
    });
    expect(baseline.style.clipPath).toBe('inset(0 70% 0 0)');
    expect(screen.getByRole('button', { name: 'Diff' })).toBeDisabled();
  });

  it('overlays the diff on the new image in 2 up and 1 up', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed');
    const diff = screen.getByRole('button', { name: 'Diff' });
    expect(diff).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('slider', { name: 'Diff opacity' })).not.toBeInTheDocument();

    fireEvent.click(diff);
    expect(diff).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'Diff' })).toHaveAttribute('src', img('4'));
    expect(screen.getByRole('img', { name: 'Diff' })).toHaveStyle({ opacity: '1' });
    fireEvent.change(screen.getByRole('slider', { name: 'Diff opacity' }), {
      target: { value: '25' },
    });
    expect(screen.getByRole('img', { name: 'Diff' })).toHaveStyle({ opacity: '0.25' });

    selectMode('1 up');
    expect(screen.getByRole('img', { name: 'Diff' })).toBeInTheDocument();
    fireEvent.click(diff);
    expect(screen.queryByRole('img', { name: 'Diff' })).not.toBeInTheDocument();
  });

  it('toggles zoom between fit and 100%', async () => {
    const { container } = await openSnapshot('/builds/build-12/snapshots/snap-changed');

    expect(container.querySelector('.viewer-pane')).toHaveAttribute('data-zoom', 'fit');
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(container.querySelector('.viewer-pane')).toHaveAttribute('data-zoom', 'actual');
    expect(screen.getByRole('button', { name: '100%' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(container.querySelector('.viewer-pane')).toHaveAttribute('data-zoom', 'fit');
  });
});

describe('SnapshotPage missing images', () => {
  it('shows "No baseline" for a new story and has no diff to toggle', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-new');

    expect(screen.getByText('No baseline: this story is new.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'New' })).toHaveAttribute('src', img('1'));
    expect(screen.getByRole('button', { name: 'Diff' })).toBeDisabled();
    selectMode('Slider');
    expect(screen.getByText(/needs both a baseline and a new image/)).toBeInTheDocument();
  });

  it('shows no new image for a removed story, and disables review', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-removed?filter=removed');

    expect(screen.getByText('No new image: this story was removed.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Baseline' })).toHaveAttribute('src', img('8'));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
  });

  it('explains an errored story and disables review', async () => {
    await openSnapshot('/builds/build-11/snapshots/snap-error');

    expect(screen.getByText(/failed to render in this build/)).toBeInTheDocument();
    expect(screen.getByText('No new image: the story failed to render.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'a' });
    expect(apiState.calls).toEqual([]);
  });

  it('marks an unstable story as never blocking and not reviewable', async () => {
    await openSnapshot('/builds/build-11/snapshots/snap-unstable');

    expect(screen.getByText(/never block/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });
});

describe('SnapshotPage review', () => {
  it('approves, then reverses to deny, updating the badges', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed?filter=unreviewed');
    const review = screen.getByRole('status', { name: 'Review' });

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(review).toHaveTextContent('Approved');
    });
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/by octocat on/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Review' })).toHaveTextContent('Denied');
    });
    expect(apiState.calls).toHaveLength(2);
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
  });

  it('shows the API error when a decision is rejected', async () => {
    server.use(
      http.post('*/api/snapshots/:id/review', () => apiError(409, 'conflict', 'Not reviewable')),
    );
    await openSnapshot('/builds/build-12/snapshots/snap-new');

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not reviewable');
  });

  it('keeps the shortcut hints in tooltips, not in the button names', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed');

    expect(screen.getByRole('button', { name: 'Approve' })).toHaveAttribute('title', 'Approve (a)');
    expect(screen.getByRole('button', { name: 'Deny' })).toHaveAttribute('title', 'Deny (d)');
    const nav = screen.getByRole('navigation', { name: 'Snapshots' });
    expect(within(nav).getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'title',
      'Previous (k or ←)',
    );
  });
});
