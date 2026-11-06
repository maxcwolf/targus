import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { project } from '../../test/fixtures.ts';
import { apiError, server } from '../../test/msw.ts';
import { renderApp } from '../../test/render.tsx';

function buildRow(link: HTMLElement): HTMLElement {
  const row = link.closest('li');
  if (!row) throw new Error('build row missing');
  return row;
}

describe('ProjectsPage', () => {
  it('shows project cards with repo and org, linking to the builds page', async () => {
    renderApp('/');

    const link = await screen.findByRole('link', { name: 'Mobile app' });
    expect(link).toHaveAttribute('href', '/projects/project-1');
    const card = link.closest('li');
    expect(card).toHaveClass('project-card');
    expect(card).toHaveTextContent('acme/mobile');
    expect(card).toHaveTextContent('acme');
    const rail = screen.getByRole('navigation', { name: 'App' });
    expect(within(rail).getByRole('link', { name: 'Projects' })).toHaveClass('active');
    expect(within(rail).queryByRole('link', { name: 'Builds' })).not.toBeInTheDocument();
  });

  it('says so when there are no projects', async () => {
    server.use(http.get('*/api/projects', () => HttpResponse.json({ projects: [] })));
    renderApp('/');

    expect(await screen.findByText(/No projects yet/)).toBeInTheDocument();
  });
});

describe('BuildsPage', () => {
  it('shows each build with status, branch, sha and PR links, and the change summary', async () => {
    renderApp(`/projects/${project.id}`);

    expect(await screen.findByRole('heading', { name: 'Mobile app' })).toBeInTheDocument();
    const buildLink = await screen.findByRole('link', { name: 'Build 12' });
    expect(buildLink).toHaveAttribute('href', '/builds/build-12');
    const row = buildRow(buildLink);
    const cells = within(row);
    expect(cells.getByRole('status', { name: 'Build status' })).toHaveTextContent('Pending review');
    expect(cells.getByText('feature/buttons')).toBeInTheDocument();
    expect(cells.getByRole('link', { name: 'PR #34' })).toHaveAttribute(
      'href',
      'https://github.com/acme/mobile/pull/34',
    );
    expect(cells.getByRole('link', { name: 'abcdef1' })).toHaveAttribute(
      'href',
      'https://github.com/acme/mobile/commit/abcdef1234567890abcdef1234567890abcdef12',
    );
    expect(cells.getByText('3 changes · 1 new · 1 removed')).toBeInTheDocument();
    expect(cells.getByText('4 stories')).toBeInTheDocument();
    expect(row).toHaveTextContent('2026');
  });

  it('shows the failed main build with its error count and no PR', async () => {
    renderApp(`/projects/${project.id}`);

    const row = buildRow(await screen.findByRole('link', { name: 'Build 11' }));
    expect(within(row).getByRole('status', { name: 'Build status' })).toHaveTextContent('Failed');
    expect(within(row).getByText('0 changes · 1 unstable · 1 error')).toHaveClass('has-error');
    expect(within(row).getByText('2 stories')).toBeInTheDocument();
    expect(within(row).queryByRole('link', { name: /PR/ })).not.toBeInTheDocument();
  });
});

describe('BuildsPage edge cases', () => {
  it('shows not found for a project the reviewer cannot see', async () => {
    renderApp('/projects/unknown');

    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
  });

  it('says so when a project has no builds', async () => {
    server.use(http.get('*/api/projects/:id/builds', () => HttpResponse.json({ builds: [] })));
    renderApp(`/projects/${project.id}`);

    expect(await screen.findByText('No builds yet.')).toBeInTheDocument();
  });

  it('shows the error when the builds request fails', async () => {
    server.use(
      http.get('*/api/projects/:id/builds', () =>
        apiError(403, 'forbidden', "You're not a member of acme"),
      ),
    );
    renderApp(`/projects/${project.id}`);

    expect(await screen.findByRole('alert')).toHaveTextContent("You're not a member of acme");
  });
});
