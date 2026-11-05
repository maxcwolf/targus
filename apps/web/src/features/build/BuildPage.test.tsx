import { fireEvent, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { apiError, apiState, server } from '../../test/msw.js';
import { renderApp } from '../../test/render.js';

function rowNames(): string[] {
  return screen
    .queryAllByRole('listitem')
    .map((item) => within(item).getByRole('link').textContent);
}

describe('BuildPage', () => {
  it('shows the header with status, refs, device and the summary line', async () => {
    renderApp('/builds/build-12');

    expect(await screen.findByRole('heading', { name: /Build #12/ })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Build status' })).toHaveTextContent(
      /^Pending review$/,
    );
    expect(screen.getByRole('link', { name: 'Mobile app' })).toHaveAttribute(
      'href',
      '/projects/project-1',
    );
    expect(screen.getByRole('link', { name: 'PR #34' })).toHaveAttribute(
      'href',
      'https://github.com/acme/mobile/pull/34',
    );
    expect(screen.getByRole('link', { name: 'abcdef1' })).toBeInTheDocument();
    expect(screen.getByText('iPhone 16 / iOS 18.2')).toBeInTheDocument();
    expect(screen.getByText('2 changes awaiting review')).toBeInTheDocument();
  });

  it('opens on the unreviewed changes, grouped by title, linking with the filter', async () => {
    renderApp('/builds/build-12');

    expect(await screen.findByRole('tab', { name: /Unreviewed/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(rowNames()).toEqual(['Large', 'Primary']);
    const group = screen.getByRole('region', { name: 'Button' });
    const link = within(group).getByRole('link', { name: 'Primary' });
    expect(link).toHaveAttribute(
      'href',
      '/builds/build-12/snapshots/snap-changed?filter=unreviewed',
    );
    expect(within(group).getByText('1.23%')).toBeInTheDocument();
    expect(within(group).getByRole('status', { name: 'Review' })).toHaveTextContent('Pending');
  });
});

describe('BuildPage filters', () => {
  it('changes the rows when a filter tab is selected', async () => {
    renderApp('/builds/build-12');
    const tabs = await screen.findByRole('tablist', { name: 'Filter snapshots' });
    const pick = async (name: RegExp): Promise<void> => {
      fireEvent.click(within(tabs).getByRole('tab', { name }));
      await screen.findByRole('tab', { name, selected: true });
    };

    await pick(/Approved/);
    expect(rowNames()).toEqual(['Default']);
    await pick(/Removed/);
    // A removed story has no name or title: it falls back to the story id and its prefix.
    expect(rowNames()).toEqual(['legacy--old']);
    expect(screen.getByRole('heading', { name: 'legacy' })).toBeInTheDocument();
    await pick(/New/);
    expect(rowNames()).toEqual(['Large']);
    await pick(/Changed/);
    expect(rowNames()).toEqual(['Primary', 'Default']);
    await pick(/Denied/);
    expect(screen.getByText('No snapshots match this filter.')).toBeInTheDocument();
    await pick(/All/);
    expect(rowNames()).toHaveLength(5);
  });

  it('shows filter counts on the tabs', async () => {
    renderApp('/builds/build-12?filter=all');

    expect(await screen.findByRole('tab', { name: 'Unreviewed2' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All5' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('BuildPage approve all', () => {
  it('approves all pending changes after an inline confirmation', async () => {
    renderApp('/builds/build-12');

    fireEvent.click(await screen.findByRole('button', { name: 'Approve all' }));
    expect(apiState.calls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve all' }));
    fireEvent.click(screen.getByRole('button', { name: /^Confirm/ }));

    expect(await screen.findByText('All changes approved')).toBeInTheDocument();
    expect(apiState.calls).toEqual(['POST /api/builds/build-12/approve-all']);
    expect(screen.getByRole('status', { name: 'Build status' })).toHaveTextContent('Accepted');
    // Nothing is unreviewed any more, so the default filter falls back to All.
    expect(await screen.findByRole('tab', { name: 'All5', selected: true })).toBeInTheDocument();
    const reviews = screen.getAllByRole('status', { name: 'Review' });
    expect(reviews.map((badge) => badge.textContent)).toEqual(['Approved', 'Approved', 'Approved']);
    expect(screen.getByRole('button', { name: 'Approve all' })).toBeDisabled();
  });

  it('names the number of changes in the confirmation', async () => {
    renderApp('/builds/build-12');

    fireEvent.click(await screen.findByRole('button', { name: 'Approve all' }));
    expect(screen.getByRole('button', { name: 'Confirm: approve 2 changes' })).toBeInTheDocument();
  });

  it('shows the API error when approve-all fails', async () => {
    server.use(
      http.post('*/api/builds/:id/approve-all', () =>
        apiError(409, 'conflict', 'Build is still in progress'),
      ),
    );
    renderApp('/builds/build-12');

    fireEvent.click(await screen.findByRole('button', { name: 'Approve all' }));
    fireEvent.click(screen.getByRole('button', { name: /^Confirm/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Build is still in progress');
  });
});

describe('BuildPage states', () => {
  it('opens on all snapshots and explains the failure for a failed build', async () => {
    renderApp('/builds/build-11');

    expect(
      await screen.findByText('1 story failed to render; a later build must fix it'),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Approve all' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /PR #/ })).not.toBeInTheDocument();
  });

  it('shows a not-found message for an unknown build', async () => {
    renderApp('/builds/nope');

    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
    expect(screen.getByText('Build not found')).toBeInTheDocument();
  });

  it('disables approve-all while the build is still uploading', async () => {
    server.use(
      http.get('*/api/builds/:id', () =>
        HttpResponse.json({
          build: { ...apiState.builds[0], status: 'in_progress' },
          summary: {
            status: 'in_progress',
            conclusion: null,
            pendingCount: 0,
            deniedCount: 0,
            errorCount: 0,
          },
          counts: { unchanged: 0, changed: 0, new: 0, removed: 0, unstable: 0, error: 0 },
        }),
      ),
    );
    renderApp('/builds/build-12');

    expect(await screen.findByText(/Capture in progress/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve all' })).toBeDisabled();
  });
});
