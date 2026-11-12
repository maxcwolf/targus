import { screen, within } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { hash, initialSnapshots, mainBuild, project } from '../../test/fixtures.ts';
import { apiError, apiState, server } from '../../test/msw.ts';
import { renderApp } from '../../test/render.tsx';

const history = (): Promise<HTMLElement> => screen.findByRole('region', { name: 'History' });

/** The button story as build 11 on main first captured it, before build 12 changed it. */
function captureOnMain(): void {
  const changed = initialSnapshots().find((snapshot) => snapshot.id === 'snap-changed');
  if (changed === undefined) throw new Error('the fixtures have no changed snapshot');
  apiState.snapshots.push({
    ...changed,
    id: 'snap-first',
    buildId: mainBuild.id,
    state: 'new',
    review: 'approved',
    imageHash: hash('3'),
    baselineHash: null,
    diffHash: null,
    diffRatio: null,
  });
}

describe('StoryHistory on a snapshot', () => {
  it('lists the builds that changed the story, newest first, and marks the one on screen', async () => {
    captureOnMain();
    renderApp('/builds/build-12/snapshots/snap-changed');

    const rows = await within(await history()).findAllByRole('link');

    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Build 12 on feature/buttons',
      'Build 11 on main',
    ]);
    expect(rows[0]).toHaveAttribute('aria-current', 'page');
    expect(rows[0]).toHaveTextContent('Build 12feature/buttons');
    expect(rows[0]).toHaveTextContent('ChangedUnreviewed');
    expect(rows[1]).not.toHaveAttribute('aria-current');
    expect(rows[1]).toHaveAttribute('href', '/builds/build-11/snapshots/snap-first');
    expect(rows[1]).toHaveTextContent('main · 1234567');
    expect(rows[1]?.querySelector('img')).toHaveAttribute('src', `/api/images/${hash('3')}`);
  });

  it('shows no decision and no thumbnail for a story that was removed', async () => {
    renderApp('/builds/build-12/snapshots/snap-removed?filter=removed');

    const row = await within(await history()).findByRole('link', {
      name: 'Build 12 on feature/buttons',
    });

    expect(row).toHaveTextContent('Removed');
    expect(row).not.toHaveTextContent('Approved');
    expect(row.querySelector('img')).not.toBeInTheDocument();
  });

  it('says so when no build changed the story, and when the history cannot be read', async () => {
    const first = renderApp('/builds/build-12/snapshots/snap-unchanged?filter=all');
    expect(
      await within(await history()).findByText('No build has changed this story yet.'),
    ).toBeInTheDocument();
    first.unmount();

    server.use(
      http.get('*/api/projects/:projectId/history', () => apiError(500, 'internal', 'boom')),
    );
    renderApp('/builds/build-12/snapshots/snap-changed');
    expect(await history()).toHaveTextContent('Loading the history…');
    expect(
      await within(await history()).findByText(
        'Could not load the history of this story.',
        undefined,
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
  });
});

describe('StoryHistory in the library', () => {
  it('lists the story’s changes under its accepted image, with none marked', async () => {
    renderApp(`/projects/${project.id}/library?story=button--primary`);

    const row = await within(await history()).findByRole('link', {
      name: 'Build 12 on feature/buttons',
    });

    expect(row).not.toHaveAttribute('aria-current');
    expect(row).toHaveAttribute('href', '/builds/build-12/snapshots/snap-changed');
  });
});
