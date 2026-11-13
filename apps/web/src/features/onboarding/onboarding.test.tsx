import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { apiError, apiState, newProjectToken, server } from '../../test/msw.ts';
import { renderApp } from '../../test/render.tsx';
import { validateNewProjectSearch, validateSetupSearch } from './search.ts';

const repoStep = () => screen.findByRole('region', { name: '2. Repository' });

describe('ProjectsPage', () => {
  it('is reached from the projects page', async () => {
    renderApp('/');

    const link = await screen.findByRole('link', { name: 'New project' });
    expect(link).toHaveAttribute('href', '/new');
  });
});

describe('NewProjectPage', () => {
  it('lists the only account’s repositories, linking the ones that have a project', async () => {
    renderApp('/new');

    const accounts = await screen.findByRole('region', { name: '1. GitHub account' });
    expect(within(accounts).getByRole('link', { name: 'acme' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(
      within(accounts).getByRole('link', { name: /Install the targus GitHub App/ }),
    ).toHaveAttribute('href', 'https://github.com/apps/targus-review/installations/new');
    const repos = await repoStep();
    expect(
      await within(repos).findByRole('link', { name: 'Open the project for acme/mobile' }),
    ).toHaveAttribute('href', '/projects/project-1');
    expect(
      within(repos).getByRole('button', { name: 'Create project for acme/web' }),
    ).toBeEnabled();
    expect(within(repos).getByText('trunk')).toBeInTheDocument();
  });

  it('creates a project and shows its token once, with the commands to publish', async () => {
    renderApp('/new?installation=7');

    fireEvent.click(await screen.findByRole('button', { name: 'Create project for acme/web' }));

    expect(await screen.findByRole('heading', { name: 'web is ready' })).toBeInTheDocument();
    expect(screen.getByLabelText('Project token')).toHaveTextContent(newProjectToken);
    expect(screen.getByText(/npx targus run --from-capture/)).toHaveTextContent(
      `TARGUS_API_URL=${globalThis.location.origin}`,
    );
    expect(screen.getByRole('link', { name: 'Open the project' })).toHaveAttribute(
      'href',
      '/projects/project-acme-web',
    );
    expect(apiState.calls).toEqual(['POST /api/installations/7/projects acme/web']);
  });

  it('shows why a project could not be created and lets the reviewer retry', async () => {
    server.use(
      http.post('*/api/installations/:id/projects', () =>
        apiError(409, 'conflict', 'acme/web already has a project'),
      ),
    );
    renderApp('/new?installation=7');

    fireEvent.click(await screen.findByRole('button', { name: 'Create project for acme/web' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('acme/web already has a project');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create project for acme/web' })).toBeEnabled();
    });
  });
});

describe('NewProjectPage accounts', () => {
  it('asks for an account when there are several, and none without an install link', async () => {
    apiState.installations = {
      installations: [
        { installationId: 7, account: 'acme' },
        { installationId: 8, account: 'zeta' },
      ],
      installUrl: null,
    };
    renderApp('/new');

    const accounts = await screen.findByRole('region', { name: '1. GitHub account' });
    expect(within(accounts).getByRole('link', { name: 'zeta' })).toHaveAttribute(
      'href',
      '/new?installation=8',
    );
    expect(within(accounts).getByRole('link', { name: 'acme' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(within(accounts).getByText(/ask whoever runs this targus server/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '2. Repository' })).not.toBeInTheDocument();
  });

  it('opens on the installation GitHub sends back to /setup, even with no account listed', async () => {
    apiState.installations = { ...apiState.installations, installations: [] };
    apiState.installationRepos = [];
    const { router } = renderApp('/setup?installation_id=7&setup_action=install');

    const repos = await repoStep();
    expect(await within(repos).findByText(/None yet/)).toBeInTheDocument();
    expect(router.state.location.href).toBe('/new?installation=7');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows the API error for an installation the reviewer cannot use', async () => {
    renderApp('/new?installation=9');

    const repos = await repoStep();
    expect(await within(repos).findByText('Installation not found')).toBeInTheDocument();
  });

  it('shows the error when the accounts cannot be loaded', async () => {
    server.use(http.get('*/api/installations', () => HttpResponse.json({}, { status: 500 })));
    renderApp('/new');

    expect(await screen.findByText(/targus API answered 500/)).toBeInTheDocument();
  });
});

describe('onboarding search', () => {
  it('keeps a positive integer installation and drops anything else', () => {
    expect(validateNewProjectSearch({ installation: '7' })).toEqual({ installation: 7 });
    expect(validateNewProjectSearch({ installation: 7 })).toEqual({ installation: 7 });
    for (const installation of ['abc', '0', -1, undefined]) {
      expect(validateNewProjectSearch({ installation })).toEqual({});
    }
    expect(validateSetupSearch({ installation_id: '12', setup_action: 'install' })).toEqual({
      installation: 12,
    });
    expect(validateSetupSearch({})).toEqual({});
  });
});
