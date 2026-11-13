import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { project } from '../../test/fixtures.ts';
import { apiState } from '../../test/msw.ts';
import { renderApp } from '../../test/render.tsx';

describe('a feature that is turned off', () => {
  it('has no link in the rail and no page', async () => {
    apiState.features = { ...apiState.features, library: false };
    renderApp(`/projects/${project.id}`);

    await screen.findByRole('link', { name: 'Build 12' });
    const rail = screen.getByRole('navigation', { name: 'App' });
    expect(within(rail).getByRole('link', { name: 'Builds' })).toBeInTheDocument();
    expect(within(rail).queryByRole('link', { name: 'Library' })).not.toBeInTheDocument();
  });

  it('answers its address like any unknown page', async () => {
    apiState.features = { ...apiState.features, library: false };
    renderApp(`/projects/${project.id}/library`);

    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Library' })).not.toBeInTheDocument();
  });

  it('is there when it is on', async () => {
    renderApp(`/projects/${project.id}/library`);

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    const rail = screen.getByRole('navigation', { name: 'App' });
    expect(await within(rail).findByRole('link', { name: 'Library' })).toBeInTheDocument();
  });
});
