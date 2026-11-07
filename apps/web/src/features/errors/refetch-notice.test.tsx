import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { apiError, server } from '../../test/msw.ts';
import { loadImages, renderApp } from '../../test/render.tsx';

/** What the browser does when the reviewer comes back to the tab: active queries refetch. */
function refocusWindow(): void {
  fireEvent(window, new Event('visibilitychange'));
}

/** Answer every GET of `path` with a 500 from now on. */
function failGets(...paths: readonly string[]): void {
  server.use(
    ...paths.map((path) => http.get(path, () => apiError(500, 'internal', 'Upstream timeout'))),
  );
}

const noBuilds = { builds: [], nextCursor: null };

const notice = (): Promise<HTMLElement> => screen.findByText(/Could not refresh this page/);

async function expectPageKept(heading: string | RegExp): Promise<void> {
  expect(await notice()).toHaveTextContent('Upstream timeout');
  expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
}

describe('a failed refetch keeps the review pages', () => {
  it('keeps the snapshot page when the refetch after an approve fails', async () => {
    renderApp('/builds/build-12/snapshots/snap-new?filter=all');
    await screen.findByRole('tablist', { name: 'Viewer mode' });
    loadImages();
    failGets('*/api/builds/:buildId/snapshots', '*/api/projects/:projectId/builds');

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Approved Avatar / Large')).toBeInTheDocument();
    await expectPageKept('Avatar : Large');
    expect(screen.getByRole('status', { name: 'Review' })).toHaveTextContent('Approved');
  });

  it('keeps the build page when a refetch on window focus fails, until one succeeds', async () => {
    renderApp('/builds/build-12');
    await screen.findByRole('heading', { level: 1, name: /Build 12/ });
    failGets('*/api/builds/:buildId');

    refocusWindow();
    await expectPageKept(/Build 12/);

    server.resetHandlers();
    refocusWindow();
    await waitFor(() => {
      expect(screen.queryByText(/Could not refresh this page/)).not.toBeInTheDocument();
    });
  });

  it('still shows the error page when the first load fails', async () => {
    failGets('*/api/builds/:buildId/snapshots');
    renderApp('/builds/build-12');

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  });
});

describe('a failed refetch keeps the project pages', () => {
  it('keeps the projects page', async () => {
    renderApp('/');
    await screen.findByRole('link', { name: 'Mobile app' });
    failGets('*/api/projects');

    refocusWindow();

    await expectPageKept('Projects');
    expect(screen.getByRole('link', { name: 'Mobile app' })).toBeInTheDocument();
  });

  it('keeps the builds page when the project or the builds fail to refresh', async () => {
    renderApp('/projects/project-1');
    await screen.findByRole('link', { name: 'Build 12' });
    failGets('*/api/projects', '*/api/projects/:projectId/builds');

    refocusWindow();

    await waitFor(() => {
      expect(screen.getAllByText(/Could not refresh this page/)).toHaveLength(2);
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Mobile app' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Build 12' })).toBeInTheDocument();
  });

  it('marks an empty builds list as out of date too', async () => {
    server.use(http.get('*/api/projects/:projectId/builds', () => HttpResponse.json(noBuilds)));
    renderApp('/projects/project-1');
    await screen.findByText('No builds yet.');
    failGets('*/api/projects/:projectId/builds');

    refocusWindow();

    await expectPageKept('Mobile app');
    expect(screen.getByText('No builds yet.')).toBeInTheDocument();
  });

  it('keeps the library page', async () => {
    renderApp('/projects/project-1/library');
    await screen.findByRole('heading', { level: 1, name: 'Library' });
    failGets('*/api/projects/:projectId/library');

    refocusWindow();

    await expectPageKept('Library');
    expect(screen.getByRole('link', { name: /Build 10/ })).toBeInTheDocument();
  });
});
