import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiError, apiState, server } from '../../test/msw.ts';
import { loadImages, renderApp } from '../../test/render.tsx';

// The real API answers 401 on every review route once the session cookie is gone. Falling
// through (returning nothing) hands the request to the normal handlers while signed in.
beforeEach(() => {
  server.use(
    http.all('*/api/*', () =>
      apiState.signedIn ? undefined : apiError(401, 'unauthorized', 'Sign in first'),
    ),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const signInHref = (returnTo: string): string =>
  `/api/auth/github?${new URLSearchParams({ returnTo }).toString()}`;

/** The "signed out" notice the auth gate puts above the page. */
async function expiredNotice(): Promise<HTMLElement> {
  const text = await screen.findByText('You are signed out.');
  const notice = text.closest('[role="alert"]');
  if (!(notice instanceof HTMLElement)) throw new Error('expected the notice to be an alert');
  return notice;
}

describe('a session that expires mid-visit', () => {
  it('keeps a failed approve on screen as not saved and offers sign-in back to the page', async () => {
    const path = '/builds/build-12/snapshots/snap-changed?filter=all#viewer';
    renderApp(path);
    await screen.findByRole('tablist', { name: 'Viewer mode' });
    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('octocat')).toBeInTheDocument();

    loadImages();
    apiState.signedIn = false;
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    const notice = await expiredNotice();
    expect(within(notice).getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      signInHref(path),
    );
    expect(screen.getByRole('alert', { name: 'Failed decisions' })).toHaveTextContent(
      'Button / Primary: Approve failed. Not saved: your session has expired.',
    );
    expect(screen.getByRole('status', { name: 'Review' })).not.toHaveTextContent('Approved');
    expect(screen.queryByText(/^Approved Button/)).not.toBeInTheDocument();
    expect(apiState.snapshots.find((s) => s.id === 'snap-changed')?.review).toBe('pending');
    expect(within(banner).queryByText('octocat')).not.toBeInTheDocument();
  });

  it('shows a failed batch approve as not saved', async () => {
    renderApp('/builds/build-12');
    fireEvent.click(await screen.findByRole('button', { name: 'Batch' }));

    apiState.signedIn = false;
    fireEvent.click(screen.getByRole('button', { name: /^Confirm/ }));

    await expiredNotice();
    expect(screen.getByText(/^Not saved: your session has expired/)).toBeInTheDocument();
    expect(screen.queryByText('All changes approved')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Batch' })).toBeEnabled();
  });

  it('says a page could not load and links to sign-in once, from the notice', async () => {
    renderApp('/');
    fireEvent.click(await screen.findByRole('link', { name: 'Mobile app' }));

    apiState.signedIn = false;
    // The builds page asks for its list now, and gets the 401.
    expect(await screen.findByRole('heading', { name: 'Signed out' })).toBeInTheDocument();
    await expiredNotice();
    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /Sign in/ })).toHaveLength(1);
    });
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      signInHref('/projects/project-1'),
    );
  });
});

describe('the root error view', () => {
  it('replaces a page that crashes while rendering, keeping the layout and no details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The snapshot sidebar scrolls the current story into view; make that throw.
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {
      throw new RangeError('secret internals at SnapshotSidebar.tsx');
    });
    renderApp('/builds/build-12/snapshots/snap-changed?filter=all');

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    expect(within(alert).getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    expect(alert).not.toHaveTextContent('secret internals');
    expect(within(screen.getByRole('banner')).getByText('octocat')).toBeInTheDocument();
  });
});
