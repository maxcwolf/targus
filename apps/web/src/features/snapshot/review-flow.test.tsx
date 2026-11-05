import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiState } from '../../test/msw.js';
import { renderApp } from '../../test/render.js';

async function openSnapshot(path: string): Promise<void> {
  renderApp(path);
  await screen.findByRole('tablist', { name: 'Viewer mode' });
}

function reviewBadge(): HTMLElement {
  return screen.getByRole('status', { name: 'Review' });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('snapshot sidebar', () => {
  it('lists the navigation order grouped by title and highlights the current snapshot', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    await openSnapshot('/builds/build-12/snapshots/snap-changed?filter=all');

    const sidebar = screen.getByRole('navigation', { name: 'Build snapshots' });
    const links = within(sidebar).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Large',
      'Primary',
      'Default',
      'legacy--old',
      'Body',
    ]);
    expect(within(sidebar).getByRole('heading', { name: 'Button' })).toBeInTheDocument();
    const current = within(sidebar).getByRole('link', { name: 'Primary' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveClass('current');
    expect(current).toHaveTextContent('1.23%');
    expect(within(sidebar).getByRole('link', { name: 'Large' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(scroll).toHaveBeenCalled();

    fireEvent.click(within(sidebar).getByRole('link', { name: 'Default' }));
    expect(await screen.findByRole('heading', { name: 'Card / Default' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: 'Default' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows only the filter matches plus the current snapshot', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-new?filter=unreviewed');

    const sidebar = screen.getByRole('navigation', { name: 'Build snapshots' });
    expect(within(sidebar).getAllByRole('link')).toHaveLength(2);
  });
});

describe('auto-advance and toast', () => {
  it('moves on to the next pending snapshot after a decision in Unreviewed', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-new?filter=unreviewed');

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('heading', { name: 'Button / Primary' })).toBeInTheDocument();
    expect(screen.getByText('Approved Avatar / Large')).toHaveAttribute('aria-live', 'polite');
    expect(reviewBadge()).toHaveTextContent('Pending');
  });
});

describe('auto-advance rendering', () => {
  it('after auto-advance with the a key, shows the next snapshot everywhere', async () => {
    const { router } = renderApp('/builds/build-12/snapshots/snap-new?filter=unreviewed');
    await screen.findByRole('tablist', { name: 'Viewer mode' });

    fireEvent.keyDown(window, { key: 'a' });

    expect(await screen.findByText('Approved Avatar / Large')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/builds/build-12/snapshots/snap-changed');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Button / Primary');
    const sidebar = screen.getByRole('navigation', { name: 'Build snapshots' });
    expect(within(sidebar).getByRole('link', { name: 'Primary' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Approved, so it left the Unreviewed list.
    expect(within(sidebar).queryByRole('link', { name: 'Large' })).not.toBeInTheDocument();
    expect(reviewBadge()).toHaveTextContent('Pending');
    // The next decision acts on the snapshot now shown, not the one just approved.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    });
    fireEvent.keyDown(window, { key: 'd' });
    expect(await screen.findByText('Denied Button / Primary')).toBeInTheDocument();
    expect(apiState.calls).toEqual([
      'POST /api/snapshots/snap-new/review',
      'POST /api/snapshots/snap-changed/review',
    ]);
  });
});

describe('auto-advance staying put', () => {
  it('stays put when no pending snapshot follows, so the decision can be reversed', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed?filter=unreviewed');

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(await screen.findByText('Denied Button / Primary')).toBeInTheDocument();
    expect(reviewBadge()).toHaveTextContent('Denied');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Approved Button / Primary')).toBeInTheDocument();
    expect(reviewBadge()).toHaveTextContent('Approved');
    expect(screen.getByRole('heading', { name: 'Button / Primary' })).toBeInTheDocument();
    expect(apiState.calls).toHaveLength(2);
  });

  it('does not advance outside the Unreviewed filter', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-new?filter=all');

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Approved Avatar / Large')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Avatar / Large' })).toBeInTheDocument();
  });

  it('fades the toast after about 2.5 seconds', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-new?filter=all');

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const toast = await screen.findByText('Approved Avatar / Large');
    await waitFor(
      () => {
        expect(toast).not.toBeInTheDocument();
      },
      { timeout: 4000 },
    );
  });
});

describe('viewer controls', () => {
  it('covers the image with an invisible range input for the slider split', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed');
    fireEvent.click(screen.getByRole('tab', { name: 'Slider' }));

    const input = screen.getByRole('slider', { name: 'Reveal baseline' });
    expect(input).toHaveAttribute('type', 'range');
    expect(input).toHaveValue('50');
    expect(input).toHaveClass('split-input');
    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getByRole('img', { name: 'Baseline' }).style.clipPath).toBe('inset(0 100% 0 0)');
    expect(document.querySelector('.split-line')).toHaveStyle({ left: '0%' });
  });

  it('opens the diff fully opaque with the opacity slider in the toolbar', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed');
    fireEvent.click(screen.getByRole('tab', { name: 'Diff' }));

    expect(screen.getByRole('img', { name: 'Diff' })).toHaveStyle({ opacity: '1' });
    const toolbar = screen.getByRole('tablist', { name: 'Viewer mode' }).parentElement;
    if (!toolbar) throw new Error('toolbar missing');
    expect(within(toolbar).getByRole('slider', { name: 'Diff opacity' })).toHaveValue('100');
    expect(within(toolbar).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(toolbar).getByText('2 of 2')).toBeInTheDocument();
  });

  it('keeps the shortcut hints out of the button names', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed');

    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(within(approve).getByText('a').tagName).toBe('KBD');
    expect(screen.getByRole('button', { name: 'Deny' })).toHaveTextContent('Deny d');
  });
});
