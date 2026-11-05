import { fireEvent, screen, within } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { apiError, apiState, server } from '../../test/msw.js';
import { renderApp } from '../../test/render.js';

describe('auth gate', () => {
  it('shows the sign-in link with returnTo set to the current path and search', async () => {
    apiState.signedIn = false;
    renderApp('/builds/build-12?filter=new');

    const link = await screen.findByRole('link', { name: 'Sign in with GitHub' });
    expect(link).toHaveAttribute(
      'href',
      `/api/auth/github?returnTo=${encodeURIComponent('/builds/build-12?filter=new')}`,
    );
    expect(within(screen.getByRole('banner')).queryByText('octocat')).not.toBeInTheDocument();
  });

  it('signs out, then shows the sign-in panel', async () => {
    renderApp('/');
    const banner = await screen.findByRole('banner');
    expect(await within(banner).findByText('octocat')).toBeInTheDocument();
    expect(banner.querySelector('img.avatar')).toHaveAttribute(
      'src',
      'https://avatars.githubusercontent.com/u/1',
    );

    fireEvent.click(within(banner).getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('link', { name: 'Sign in with GitHub' })).toBeInTheDocument();
    expect(apiState.calls).toContain('POST /api/auth/logout');
    expect(within(banner).queryByText('octocat')).not.toBeInTheDocument();
  });
});

describe('error pages', () => {
  it('shows the API message and a link home on 403', async () => {
    server.use(
      http.get('*/api/builds/:buildId', () =>
        apiError(403, 'forbidden', "You're not a member of acme"),
      ),
    );
    renderApp('/builds/build-12');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("You're not a member of acme");
    expect(within(alert).getByRole('link', { name: 'Back to projects' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('always says "not a member" on 403, even when the API message does not', async () => {
    server.use(http.get('*/api/projects', () => apiError(403, 'forbidden', 'Forbidden')));
    renderApp('/');

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a member/);
  });

  it('shows a sign-in panel when a page query answers 401', async () => {
    server.use(http.get('*/api/projects', () => apiError(401, 'unauthorized', 'Session expired')));
    renderApp('/');

    expect(await screen.findByRole('link', { name: 'Sign in with GitHub' })).toBeInTheDocument();
  });

  it('shows a generic error for a server failure without an error body', async () => {
    server.use(http.get('*/api/projects', () => new Response('boom', { status: 500 })));
    renderApp('/');

    expect(
      await screen.findByRole('heading', { name: 'Something went wrong' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'targus API answered 500 for /api/projects',
    );
  });
});
