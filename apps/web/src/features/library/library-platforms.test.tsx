import type { GetLibraryResponse } from '@targus/core/browser';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { hash, initialLibrary, project } from '../../test/fixtures.ts';
import { apiState } from '../../test/msw.ts';
import { renderApp } from '../../test/render.tsx';
import { validateLibrarySearch } from './stories.ts';

const library = `/projects/${project.id}/library`;

/** A project with an iOS and a web library; the web one holds a single story. */
function twoPlatforms(): void {
  const ios = initialLibrary();
  const platforms: GetLibraryResponse['platforms'] = ['ios', 'web'];
  apiState.library = { ...ios, platforms };
  const build = ios.build === null ? null : { ...ios.build, id: 'build-20', number: 20 };
  apiState.libraryByPlatform = {
    web: {
      platform: 'web',
      platforms,
      build: build && { ...build, platform: 'web', device: 'Chromium', pixelRatio: 1 },
      stories: [
        {
          storyId: 'button--primary',
          variant: 'default',
          title: 'Button',
          name: 'Primary',
          imageHash: hash('9'),
        },
      ],
    },
  };
}

describe('LibraryPage platforms', () => {
  it('has no platform switch when only one platform has a library', async () => {
    renderApp(library);

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Platform' })).not.toBeInTheDocument();
    expect(document.querySelector('.library-header')).toHaveTextContent('iOS · iPhone 16');
  });

  it('switches to another platform and keeps it in every story link', async () => {
    twoPlatforms();
    const { router } = renderApp(library);

    const tabs = await screen.findByRole('tablist', { name: 'Platform' });
    expect(within(tabs).getByRole('tab', { name: 'iOS' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Web' }));

    expect(await screen.findByRole('link', { name: 'Build 20' })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ platform: 'web' });
    expect(screen.getByRole('tab', { name: 'Web' })).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('.library-header')).toHaveTextContent('Web · Chromium');
    const card = screen.getByRole('link', { name: 'Button : Primary' });
    expect(card).toHaveAttribute('href', `${library}?story=button--primary&platform=web`);
    const sidebar = screen.getByRole('navigation', { name: 'Library stories' });
    expect(within(sidebar).getByRole('link', { name: 'All stories' })).toHaveAttribute(
      'href',
      `${library}?platform=web`,
    );
  });

  it('keeps the open story when switching, and Escape keeps the platform', async () => {
    twoPlatforms();
    const { router } = renderApp(`${library}?story=button--primary`);

    fireEvent.click(await screen.findByRole('tab', { name: 'Web' }));
    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Button : Primary' })).toHaveAttribute(
        'src',
        `/api/images/${hash('9')}`,
      );
    });
    expect(router.state.location.search).toEqual({ story: 'button--primary', platform: 'web' });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByRole('link', { name: 'Button : Primary' })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ platform: 'web' });
  });

  it('names the platform when it has no accepted build yet', async () => {
    apiState.libraryByPlatform = {
      android: { platform: 'android', platforms: ['ios', 'web'], build: null, stories: [] },
    };
    renderApp(`${library}?platform=android`);

    expect(await screen.findByText(/No accepted Android build on/)).toHaveTextContent('main');
    expect(screen.getByRole('tab', { name: 'iOS' })).toHaveAttribute('aria-selected', 'false');
  });
});

describe('validateLibrarySearch', () => {
  it('keeps a known platform and a non-empty story, and drops anything else', () => {
    expect(validateLibrarySearch({ platform: 'web', story: 'a' })).toEqual({
      platform: 'web',
      story: 'a',
    });
    expect(validateLibrarySearch({ platform: 'macos', story: '' })).toEqual({});
    expect(validateLibrarySearch({ platform: 3, story: 4 })).toEqual({});
  });
});
