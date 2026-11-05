import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { project } from '../../test/fixtures.js';
import { apiError, server } from '../../test/msw.js';
import { renderApp } from '../../test/render.js';

describe('ProjectsPage', () => {
  it('lists projects with repo and org, linking to the builds page', async () => {
    renderApp('/');

    const link = await screen.findByRole('link', { name: 'Mobile app' });
    expect(link).toHaveAttribute('href', '/projects/project-1');
    const row = link.closest('tr');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('acme/mobile');
    expect(row).toHaveTextContent('acme');
  });

  it('says so when there are no projects', async () => {
    server.use(http.get('*/api/projects', () => HttpResponse.json({ projects: [] })));
    renderApp('/');

    expect(await screen.findByText(/No projects yet/)).toBeInTheDocument();
  });
});

describe('BuildsPage', () => {
  it('shows each build with status chip, branch, PR and commit links, and counts', async () => {
    renderApp(`/projects/${project.id}`);

    const buildLink = await screen.findByRole('link', { name: '#12' });
    expect(buildLink).toHaveAttribute('href', '/builds/build-12');
    const row = buildLink.closest('tr');
    if (!row) throw new Error('build row missing');
    const cells = within(row);
    expect(cells.getByRole('status', { name: 'Build status' })).toHaveTextContent('Pending review');
    expect(cells.getByText('feature/buttons')).toBeInTheDocument();
    expect(cells.getByRole('link', { name: '#34' })).toHaveAttribute(
      'href',
      'https://github.com/acme/mobile/pull/34',
    );
    expect(cells.getByRole('link', { name: 'abcdef1' })).toHaveAttribute(
      'href',
      'https://github.com/acme/mobile/commit/abcdef1234567890abcdef1234567890abcdef12',
    );
    expect(row).toHaveTextContent('2 changed');
    expect(row).toHaveTextContent('1 new');
    expect(row).toHaveTextContent('1 removed');
    expect(row).toHaveTextContent('0 unstable');
    expect(row).not.toHaveTextContent('error');
    expect(row).toHaveTextContent('2026');
  });

  it('shows the failed main build with its error count and no PR', async () => {
    renderApp(`/projects/${project.id}`);

    const row = (await screen.findByRole('link', { name: '#11' })).closest('tr');
    if (!row) throw new Error('build row missing');
    expect(within(row).getByRole('status', { name: 'Build status' })).toHaveTextContent('Failed');
    expect(row).toHaveTextContent('1 error');
    expect(row).toHaveTextContent('1 unstable');
    expect(row).toHaveTextContent('—');
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
