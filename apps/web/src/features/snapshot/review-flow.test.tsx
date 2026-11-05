import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiState } from '../../test/msw.js';
import { renderApp } from '../../test/render.js';

async function openSnapshot(path: string): Promise<ReturnType<typeof renderApp>> {
  const app = renderApp(path);
  await screen.findByRole('tablist', { name: 'Viewer mode' });
  return app;
}

const heading = (): HTMLElement => screen.getByRole('heading', { level: 1 });
const reviewBadge = (): HTMLElement => screen.getByRole('status', { name: 'Review' });
const press = (key: string): void => {
  fireEvent.keyDown(window, { key });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('snapshot sidebar', () => {
  it('lists the navigation order grouped by title and highlights the current one', async () => {
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
    const current = within(sidebar).getByRole('link', { name: 'Primary' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveClass('current');
    expect(scroll).toHaveBeenCalled();

    fireEvent.click(within(sidebar).getByRole('link', { name: 'Default' }));
    await waitFor(() => {
      expect(heading()).toHaveTextContent('Card : Default');
    });
    expect(within(sidebar).getByRole('link', { name: 'Default' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('keyboard navigation', () => {
  it('moves with j/k and the arrow keys, keeping the filter', async () => {
    const { router } = await openSnapshot('/builds/build-12/snapshots/snap-new?filter=all');
    expect(screen.getByText('1 of 5')).toBeInTheDocument();

    press('j');
    await waitFor(() => {
      expect(heading()).toHaveTextContent('Button : Primary');
    });
    expect(router.state.location.search).toEqual({ filter: 'all' });
    press('ArrowRight');
    await waitFor(() => {
      expect(heading()).toHaveTextContent('Card : Default');
    });
    press('ArrowLeft');
    await waitFor(() => {
      expect(heading()).toHaveTextContent('Button : Primary');
    });
    press('k');
    await waitFor(() => {
      expect(heading()).toHaveTextContent('Avatar : Large');
    });
    press('k');
    expect(heading()).toHaveTextContent('Avatar : Large');
  });
});

describe('keyboard shortcuts', () => {
  it('goes back to the build with Escape', async () => {
    const { router } = await openSnapshot('/builds/build-12/snapshots/snap-new?filter=new');

    press('Escape');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/builds/build-12');
    });
    expect(router.state.location.search).toEqual({ filter: 'new' });
  });

  it('switches modes with 1/2, toggles Diff with 3 and the 1 up image with s', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed');

    press('1');
    expect(screen.getByRole('tab', { name: '1 up' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('img', { name: 'New' })).toBeInTheDocument();
    press('s');
    expect(screen.getByRole('img', { name: 'Baseline' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'New' })).not.toBeInTheDocument();
    press('s');
    press('3');
    expect(screen.getByRole('button', { name: 'Diff' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'Diff' })).toBeInTheDocument();
    press('2');
    expect(screen.getByRole('tab', { name: '2 up' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('img', { name: 'Baseline' })).toBeInTheDocument();
    press('3');
    expect(screen.queryByRole('img', { name: 'Diff' })).not.toBeInTheDocument();
  });

  it('ignores shortcuts while an input has focus or with a modifier', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed?filter=all');
    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
    const slider = screen.getByRole('slider', { name: 'Diff opacity' });

    fireEvent.keyDown(slider, { key: 'j' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'a' });
    fireEvent.keyDown(window, { key: 'a', metaKey: true });
    fireEvent.keyDown(window, { key: 'x' });

    expect(heading()).toHaveTextContent('Button : Primary');
    expect(reviewBadge()).toHaveTextContent('Unreviewed');
    expect(apiState.calls).toEqual([]);
  });
});

describe('auto-advance and toast', () => {
  it('after approving with a in Unreviewed, shows the next snapshot everywhere', async () => {
    const { router } = await openSnapshot('/builds/build-12/snapshots/snap-new?filter=unreviewed');

    press('a');

    expect(await screen.findByText('Approved Avatar / Large')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    expect(router.state.location.pathname).toBe('/builds/build-12/snapshots/snap-changed');
    expect(heading()).toHaveTextContent('Button : Primary');
    const sidebar = screen.getByRole('navigation', { name: 'Build snapshots' });
    expect(within(sidebar).getByRole('link', { name: 'Primary' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Approved, so it left the Unreviewed list.
    expect(within(sidebar).queryByRole('link', { name: 'Large' })).not.toBeInTheDocument();
    expect(reviewBadge()).toHaveTextContent('Unreviewed');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    });
    press('d');
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
    expect(heading()).toHaveTextContent('Button : Primary');
  });

  it('does not advance outside Unreviewed, and fades the toast after about 2.5 s', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-new?filter=all');

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const toast = await screen.findByText('Approved Avatar / Large');
    expect(heading()).toHaveTextContent('Avatar : Large');
    await waitFor(
      () => {
        expect(toast).not.toBeInTheDocument();
      },
      { timeout: 4000 },
    );
  });
});

describe('slider control', () => {
  it('covers the image with an invisible range input for the split', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed');
    fireEvent.click(screen.getByRole('tab', { name: 'Slider' }));

    const input = screen.getByRole('slider', { name: 'Reveal baseline' });
    expect(input).toHaveValue('50');
    expect(input).toHaveClass('split-input');
    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getByRole('img', { name: 'Baseline' }).style.clipPath).toBe('inset(0 100% 0 0)');
    expect(document.querySelector('.split-line')).toHaveStyle({ left: '0%' });
  });
});
