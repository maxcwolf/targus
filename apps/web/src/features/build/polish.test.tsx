import { fireEvent, screen, within } from '@testing-library/react';
import { delay, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { apiState, server } from '../../test/msw.js';
import { renderApp } from '../../test/render.js';

describe('build page progress', () => {
  it('draws accepted, denied and unreviewed segments', async () => {
    apiState.snapshots = apiState.snapshots.map((s) =>
      s.id === 'snap-new' ? { ...s, review: 'denied' } : s,
    );
    renderApp('/builds/build-12?filter=all');

    const bar = await screen.findByRole('img', { name: '2 of 3 changes reviewed, 1 denied' });
    const width = (selector: string): string | undefined =>
      bar.querySelector<HTMLElement>(selector)?.style.width;
    expect(width('.progress-approved')).toMatch(/^33\.33/);
    expect(width('.progress-denied')).toMatch(/^33\.33/);
    expect(width('.progress-unreviewed')).toMatch(/^33\.33/);
  });

  it('adds a small bar to each component group with changes', async () => {
    renderApp('/builds/build-12?filter=all');

    const group = await screen.findByRole('rowgroup', { name: 'Button' });
    expect(within(group).getByRole('img', { name: '0 of 1 change reviewed' })).toHaveClass(
      'compact',
    );
    expect(
      within(screen.getByRole('rowgroup', { name: 'Text' })).queryByRole('img'),
    ).not.toBeInTheDocument();
  });

  it('has no progress bar for a build without reviewable changes', async () => {
    renderApp('/builds/build-11');
    await screen.findByRole('heading', { name: /Build 11/ });
    expect(screen.queryByRole('img', { name: /reviewed/ })).not.toBeInTheDocument();
  });
});

describe('loading skeletons', () => {
  it('keeps a screen-reader label while the build loads', async () => {
    server.use(
      http.get('*/api/builds/:id', async () => {
        await delay('infinite');
      }),
    );
    renderApp('/builds/build-12');

    expect(await screen.findByText('Loading build…')).toHaveClass('sr-only');
  });

  it('shows skeleton rows while the builds list loads', async () => {
    server.use(
      http.get('*/api/projects/:id/builds', async () => {
        await delay('infinite');
      }),
    );
    renderApp('/projects/project-1');

    expect(await screen.findByText('Loading builds…')).toHaveClass('sr-only');
  });

  it('shows a viewer skeleton while the snapshot page loads', async () => {
    server.use(
      http.get('*/api/builds/:id/snapshots', async () => {
        await delay('infinite');
      }),
    );
    renderApp('/builds/build-12/snapshots/snap-new');

    expect(await screen.findByText('Loading snapshot…')).toBeInTheDocument();
  });
});

describe('avatar fallback', () => {
  it('replaces a broken avatar with the login initial', async () => {
    renderApp('/');
    const banner = await screen.findByRole('banner');
    await within(banner).findByText('octocat');
    const img = banner.querySelector('img.avatar');
    if (!img) throw new Error('avatar missing');

    fireEvent.error(img);

    expect(banner.querySelector('img.avatar')).toBeNull();
    expect(within(banner).getByText('O')).toHaveClass('avatar-fallback');
  });
});
