import { fireEvent, screen, within } from '@testing-library/react';
import { delay, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { apiState, server } from '../../test/msw.js';
import { renderApp } from '../../test/render.js';

describe('build page progress', () => {
  it('shows how many changes are reviewed with a two-colour bar', async () => {
    apiState.snapshots = apiState.snapshots.map((s) =>
      s.id === 'snap-new' ? { ...s, review: 'denied' } : s,
    );
    const { container } = renderApp('/builds/build-12?filter=all');

    expect(await screen.findByText('2 of 3 changes reviewed · 1 denied')).toBeInTheDocument();
    const width = (selector: string): string | undefined =>
      container.querySelector<HTMLElement>(selector)?.style.width;
    expect(width('.progress-approved')).toMatch(/^33\.33/);
    expect(width('.progress-denied')).toMatch(/^33\.33/);
  });

  it('omits the denied part when nothing is denied', async () => {
    renderApp('/builds/build-12');
    expect(await screen.findByText('1 of 3 changes reviewed')).toBeInTheDocument();
  });

  it('has no progress line for a build without reviewable changes', async () => {
    renderApp('/builds/build-11');
    await screen.findByRole('heading', { name: /Build #11/ });
    expect(screen.queryByText(/changes? reviewed/)).not.toBeInTheDocument();
  });
});

describe('build page rows', () => {
  it('shows a framed thumbnail, the story id and a group count', async () => {
    const { container } = renderApp('/builds/build-12?filter=all');

    const group = await screen.findByRole('region', { name: 'Button' });
    expect(within(group).getByRole('heading')).toHaveTextContent('Button · 1');
    expect(within(group).getByText('button--primary')).toHaveClass('story-id');
    const thumbs = container.querySelectorAll('img.thumb');
    // The removed story shows its baseline; every other row its current capture.
    expect([...thumbs].map((img) => img.getAttribute('src')?.slice(-3))).toEqual([
      '111',
      '222',
      '555',
      '888',
      '999',
    ]);
    expect(thumbs[0]).toHaveAttribute('loading', 'lazy');
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
