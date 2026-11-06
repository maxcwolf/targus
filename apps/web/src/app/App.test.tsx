import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../test/render.tsx';

describe('App', () => {
  it('renders the header with the signed-in reviewer and the projects page at /', async () => {
    renderApp('/');

    const banner = await screen.findByRole('banner');
    expect(within(banner).getByRole('link', { name: 'targus' })).toHaveAttribute('href', '/');
    expect(await within(banner).findByText('octocat')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
  });

  it('shows a not-found page for an unknown path', async () => {
    renderApp('/nowhere');

    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
  });
});
