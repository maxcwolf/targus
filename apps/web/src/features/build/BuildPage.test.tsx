import { fireEvent, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { apiError, apiState, server } from '../../test/msw.ts';
import { renderApp } from '../../test/render.tsx';

function rowNames(): string[] {
  return [...document.querySelectorAll('.story-link')].map((link) => link.textContent);
}

function counter(name: RegExp): HTMLElement {
  return within(screen.getByRole('tablist', { name: 'Filter snapshots' })).getByRole('tab', {
    name,
  });
}

async function pick(name: RegExp): Promise<void> {
  fireEvent.click(counter(name));
  await screen.findByRole('tab', { name, selected: true });
}

describe('BuildPage header', () => {
  it('shows the status, when and where it ran, the stats and the info card', async () => {
    renderApp('/builds/build-12');

    expect(await screen.findByRole('heading', { name: /Build 12/ })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Build status' })).toHaveTextContent(
      /^Pending review$/,
    );
    expect(
      screen.getByText(/^Started .*2026.* · iOS · iPhone 16 \/ iOS 18\.2 · light$/),
    ).toBeInTheDocument();
    expect(screen.getByText('2 changes awaiting review')).toBeInTheDocument();
    const stats = document.querySelector('.stats');
    expect(stats).toHaveTextContent('3Changes4Stories');
    const info = document.querySelector('.info-card');
    if (!(info instanceof HTMLElement)) throw new Error('info card missing');
    expect(within(info).getByRole('link', { name: 'PR #34' })).toHaveAttribute(
      'href',
      'https://github.com/acme/mobile/pull/34',
    );
    expect(within(info).getByRole('link', { name: 'abcdef1' })).toBeInTheDocument();
    expect(info).toHaveTextContent('feature/buttons');
    expect(info).toHaveTextContent('Baselinebuild-11');
  });

  it('puts the org / project path in the top bar and a Builds link in the rail', async () => {
    renderApp('/builds/build-12');

    const banner = await screen.findByRole('banner');
    expect(await within(banner).findByRole('link', { name: 'Mobile app' })).toHaveAttribute(
      'href',
      '/projects/project-1',
    );
    expect(banner).toHaveTextContent('acme/Mobile app');
    const rail = screen.getByRole('navigation', { name: 'App' });
    expect(within(rail).getByRole('link', { name: 'Builds' })).toHaveClass('active');
    expect(within(rail).getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/');
  });
});

describe('BuildPage counters', () => {
  it('opens on Unreviewed and links story rows with the filter', async () => {
    renderApp('/builds/build-12');

    expect(await screen.findByRole('tab', { name: '2 Unreviewed' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(rowNames()).toEqual(['Large', 'Primary']);
    const group = screen.getByRole('rowgroup', { name: 'Button' });
    expect(within(group).getByRole('link', { name: 'Primary' })).toHaveAttribute(
      'href',
      '/builds/build-12/snapshots/snap-changed?filter=unreviewed',
    );
    expect(within(group).getByRole('link', { name: 'Open snapshot' })).toBeInTheDocument();
    expect(within(group).getByText('1.23%')).toBeInTheDocument();
    expect(within(group).getByText('Unreviewed')).toHaveClass('pill');
  });

  it('shows Chromatic-style counts for every filter', async () => {
    renderApp('/builds/build-12?filter=all');

    await screen.findByRole('tab', { name: '5 Stories', selected: true });
    for (const name of [
      '3 Changes',
      '1 Accepted',
      '0 Denied',
      '2 Unreviewed',
      '1 New',
      '1 Removed',
    ]) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
  });
});

describe('BuildPage counter filters', () => {
  it('filters the table when a counter is chosen', async () => {
    renderApp('/builds/build-12');
    await screen.findByRole('tab', { name: /Unreviewed/, selected: true });

    await pick(/Changes/);
    expect(rowNames()).toEqual(['Large', 'Primary', 'Default']);
    await pick(/Accepted/);
    expect(rowNames()).toEqual(['Default']);
    expect(screen.getByText('Accepted', { selector: '.pill' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Reviewed by octocat' })).toHaveTextContent('O');
    await pick(/Removed/);
    expect(rowNames()).toEqual(['legacy--old']);
    expect(screen.getByRole('rowgroup', { name: 'legacy' })).toHaveTextContent('legacy· 1');
    await pick(/New/);
    expect(rowNames()).toEqual(['Large']);
    await pick(/Denied/);
    expect(screen.getByText('Nothing to review')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Show all snapshots' }));
    await screen.findByRole('tab', { name: /Stories/, selected: true });
    expect(rowNames()).toHaveLength(5);
  });

  it('collapses and expands a component group', async () => {
    renderApp('/builds/build-12?filter=all');
    const group = await screen.findByRole('rowgroup', { name: 'Button' });
    const toggle = within(group).getByRole('button', { name: /^Button/ });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(group).queryByRole('link', { name: 'Primary' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(within(group).getByRole('link', { name: 'Primary' })).toBeInTheDocument();
  });
});

describe('BuildPage actions', () => {
  it('makes Verify changes the primary action and opens the first unreviewed change', async () => {
    renderApp('/builds/build-12?filter=all');

    const verify = await screen.findByRole('link', { name: 'Verify changes' });
    expect(verify).toHaveClass('button', 'primary');
    expect(verify).toHaveAttribute('href', '/builds/build-12/snapshots/snap-new?filter=unreviewed');
    expect(screen.getByRole('button', { name: 'Batch' })).not.toHaveClass('primary');

    fireEvent.click(verify);
    expect(await screen.findByRole('heading', { name: /Large/ })).toBeInTheDocument();
    expect(apiState.calls).toEqual([]);
  });

  it('approves the whole batch after an inline confirmation', async () => {
    renderApp('/builds/build-12');

    fireEvent.click(await screen.findByRole('button', { name: 'Batch' }));
    expect(apiState.calls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Batch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: approve 2 changes' }));

    expect(await screen.findByText('All changes approved')).toBeInTheDocument();
    expect(apiState.calls).toEqual(['POST /api/builds/build-12/approve-all']);
    expect(screen.getByRole('status', { name: 'Build status' })).toHaveTextContent('Accepted');
    expect(await screen.findByRole('tab', { name: '3 Accepted' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '3 of 3 changes reviewed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Batch' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Verify changes' })).toBeDisabled();
  });

  it('says which changes approve-all left because another review decided them first', async () => {
    apiState.deniedDuringApproveAll = ['snap-changed'];
    renderApp('/builds/build-12');

    fireEvent.click(await screen.findByRole('button', { name: 'Batch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: approve 2 changes' }));

    expect(
      await screen.findByText('1 change not approved: another review decided it first'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Build status' })).toHaveTextContent('Denied');
  });

  it('shows the API error when approve-all fails', async () => {
    server.use(
      http.post('*/api/builds/:id/approve-all', () =>
        apiError(409, 'conflict', 'Build is still in progress'),
      ),
    );
    renderApp('/builds/build-12');

    fireEvent.click(await screen.findByRole('button', { name: 'Batch' }));
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
    expect(screen.getByRole('tab', { name: /Stories/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Batch' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Verify changes' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /PR #/ })).not.toBeInTheDocument();
    expect(document.querySelector('.info-card')).toHaveTextContent('Baselinenone');
    expect(screen.getByText('Error', { selector: '.pill' })).toBeInTheDocument();
  });

  it('shows a not-found message for an unknown build', async () => {
    renderApp('/builds/nope');

    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
    expect(screen.getByText('Build not found')).toBeInTheDocument();
  });

  it('disables both actions while the build is still uploading', async () => {
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
    expect(screen.getByRole('button', { name: 'Batch' })).toBeDisabled();
  });
});
