import { fireEvent, screen, within } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { hash, project } from '../../test/fixtures.ts';
import { apiError, apiState, server } from '../../test/msw.ts';
import { renderApp } from '../../test/render.tsx';

const library = `/projects/${project.id}/library`;

function cardNames(): string[] {
  return [...document.querySelectorAll('.story-card')].map(
    (card) => card.getAttribute('aria-label') ?? '',
  );
}

describe('LibraryPage overview', () => {
  it('shows every story of the accepted main build, grouped by component', async () => {
    renderApp(library);

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    const header = document.querySelector('.library-header');
    expect(header).toHaveTextContent('4 stories·Build 10onmain·1234567');
    expect(screen.getByRole('link', { name: 'Build 10' })).toHaveAttribute(
      'href',
      '/builds/build-10?filter=all',
    );
    expect(cardNames()).toEqual([
      'Button : Primary',
      'Button : Secondary',
      'Forms/Card : Default',
      'legacy : legacy--old (dark)',
    ]);
    const buttons = screen.getByRole('region', { name: 'Button' });
    expect(within(buttons).getByRole('heading')).toHaveTextContent('Button · 2');
    const card = within(buttons).getByRole('link', { name: 'Button : Primary' });
    expect(card).toHaveAttribute('href', `${library}?story=button--primary`);
    expect(card.querySelector('img')).toHaveAttribute('src', `/api/images/${hash('1')}`);
  });

  it('marks Library in the rail and lists the stories in the sidebar', async () => {
    renderApp(library);

    const sidebar = await screen.findByRole('navigation', { name: 'Library stories' });
    expect(within(sidebar).getByRole('link', { name: 'All stories' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(sidebar).getByRole('link', { name: 'Secondary' })).toHaveAttribute(
      'href',
      `${library}?story=button--secondary`,
    );
    const rail = screen.getByRole('navigation', { name: 'App' });
    expect(await within(rail).findByRole('link', { name: 'Library' })).toHaveClass('active');
    expect(within(rail).getByRole('link', { name: 'Builds' })).not.toHaveClass('active');
  });

  it('filters the grid and the sidebar with the search box', async () => {
    renderApp(library);
    const search = await screen.findByRole('searchbox', { name: 'Find stories' });

    fireEvent.change(search, { target: { value: 'BUTTON sec' } });
    expect(cardNames()).toEqual(['Button : Secondary']);
    const sidebar = screen.getByRole('navigation', { name: 'Library stories' });
    expect(within(sidebar).queryByRole('link', { name: 'Primary' })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'nothing like this' } });
    expect(screen.getByText('No stories match your search')).toBeInTheDocument();
  });
});

describe('LibraryPage story', () => {
  it('opens a story on its own and steps through the library', async () => {
    renderApp(library);

    fireEvent.click(await screen.findByRole('link', { name: 'Button : Secondary' }));

    expect(await screen.findByRole('heading', { name: 'Button : Secondary' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Button : Secondary' })).toHaveAttribute(
      'src',
      `/api/images/${hash('2')}`,
    );
    const steps = screen.getByRole('navigation', { name: 'Stories' });
    expect(steps).toHaveTextContent('2 of 4');
    expect(within(steps).getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      `${library}?story=button--primary`,
    );

    fireEvent.click(within(steps).getByRole('link', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'Forms/Card : Default' })).toBeVisible();
    const sidebar = screen.getByRole('navigation', { name: 'Library stories' });
    expect(within(sidebar).getByRole('link', { name: 'Default' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('LibraryPage story navigation', () => {
  it('moves with j and k, stops at the ends and returns to the overview with Escape', async () => {
    const { router } = renderApp(`${library}?story=card--default`);
    await screen.findByRole('heading', { name: 'Forms/Card : Default' });

    fireEvent.keyDown(window, { key: 'j' });
    expect(await screen.findByRole('heading', { name: /legacy--old \(dark\)/ })).toBeVisible();
    expect(router.state.location.search).toEqual({ story: 'legacy--old~dark' });
    expect(screen.queryByRole('link', { name: 'Next' })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    expect(await screen.findByRole('heading', { name: 'Forms/Card : Default' })).toBeVisible();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByRole('link', { name: 'Button : Primary' })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({});
  });

  it('keeps stepping within the search results', async () => {
    renderApp(`${library}?story=button--primary`);
    const search = await screen.findByRole('searchbox', { name: 'Find stories' });

    fireEvent.change(search, { target: { value: 'button' } });

    expect(screen.getByRole('navigation', { name: 'Stories' })).toHaveTextContent('1 of 2');
    fireEvent.change(search, { target: { value: 'card' } });
    expect(screen.getByRole('navigation', { name: 'Stories' })).toHaveTextContent('1 of 4');
  });

  it('says so when the story is not in the library', async () => {
    renderApp(`${library}?story=nope`);

    expect(await screen.findByText('The library has no such story.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All stories' })).toBeInTheDocument();
  });
});

describe('LibraryPage states', () => {
  it('explains an empty library before any main build is accepted', async () => {
    apiState.library = { build: null, stories: [] };
    renderApp(library);

    expect(await screen.findByText(/No accepted build on/)).toHaveTextContent('main');
    expect(screen.getByRole('link', { name: 'Go to builds' })).toHaveAttribute(
      'href',
      `/projects/${project.id}`,
    );
  });

  it('shows the API error and a not-found message for an unknown project', async () => {
    server.use(
      http.get('*/api/projects/:id/library', () =>
        apiError(403, 'forbidden', 'you are not a member of acme'),
      ),
    );
    renderApp(library);
    expect(await screen.findByText(/not a member of acme/)).toBeInTheDocument();
  });

  it('answers not found for a project the reviewer cannot see', async () => {
    renderApp('/projects/other/library');

    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
  });
});
