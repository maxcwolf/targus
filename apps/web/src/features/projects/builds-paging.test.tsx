import type { Build, BuildWithSummary } from '@targus/core/browser';
import { fireEvent, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { mainBuild, project } from '../../test/fixtures.ts';
import { apiError, server } from '../../test/msw.ts';
import { renderApp } from '../../test/render.tsx';

const zero = { unchanged: 0, changed: 0, new: 0, removed: 0, unstable: 0, error: 0 };

function passed(number: number): BuildWithSummary {
  const build: Build = { ...mainBuild, id: `build-${String(number)}`, number, status: 'passed' };
  const summary = { pendingCount: 0, deniedCount: 0, errorCount: 0 };
  return {
    build,
    summary: { status: 'passed', conclusion: 'success', ...summary },
    counts: zero,
  };
}

/** A project with builds 3, 2 and 1 in pages of two; `older` answers the second page. */
function pagedBuilds(older: () => Response | Promise<Response>): string[] {
  const requests: string[] = [];
  server.use(
    http.get('*/api/projects/:projectId/builds', ({ request }) => {
      const url = new URL(request.url);
      requests.push(url.search);
      if (url.searchParams.get('cursor') === 'after-2') return older();
      return HttpResponse.json({ builds: [passed(3), passed(2)], nextCursor: 'after-2' });
    }),
  );
  return requests;
}

const lastPage = (): Response => HttpResponse.json({ builds: [passed(1)], nextCursor: null });

describe('BuildsPage paging', () => {
  it('loads older builds on request until the last page, then hides the control', async () => {
    const requests = pagedBuilds(lastPage);
    renderApp(`/projects/${project.id}`);

    const more = await screen.findByRole('button', { name: 'Load more builds' });
    expect(screen.queryByRole('link', { name: 'Build 1' })).not.toBeInTheDocument();
    fireEvent.click(more);

    expect(await screen.findByRole('link', { name: 'Build 1' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^Build \d$/ }).map((l) => l.textContent)).toEqual([
      'Build 3',
      'Build 2',
      'Build 1',
    ]);
    expect(screen.queryByRole('button', { name: /more builds/ })).not.toBeInTheDocument();
    expect(requests).toEqual(['?limit=50', '?limit=50&cursor=after-2']);
  });

  it('marks the control busy while the next page loads', async () => {
    let release = (): void => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    pagedBuilds(async () => {
      await pending;
      return lastPage();
    });
    renderApp(`/projects/${project.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Load more builds' }));

    const busy = await screen.findByRole('button', { name: 'Loading more builds…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    release();
    expect(await screen.findByRole('link', { name: 'Build 1' })).toBeInTheDocument();
  });
});

describe('BuildsPage paging errors', () => {
  it('keeps the loaded builds and offers a retry when an older page fails', async () => {
    let fail = true;
    pagedBuilds(() => (fail ? apiError(500, 'internal', 'D1 is down') : lastPage()));
    renderApp(`/projects/${project.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Load more builds' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load more builds. D1 is down',
    );
    expect(screen.getByRole('link', { name: 'Build 3' })).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Load more builds' }));
    expect(await screen.findByRole('link', { name: 'Build 1' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows no control when the first page is the last', async () => {
    renderApp(`/projects/${project.id}`);

    expect(await screen.findByRole('link', { name: 'Build 12' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more builds/ })).not.toBeInTheDocument();
  });
});
