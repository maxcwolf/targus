import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { hash } from '../../test/fixtures.ts';
import { apiState } from '../../test/msw.ts';
import { loadImages, renderApp } from '../../test/render.tsx';

// jsdom never loads an image, so these tests fire `load` and `error` by hand.

const img = (digit: string): string => `/api/images/${hash(digit)}`;
const heading = (): HTMLElement => screen.getByRole('heading', { level: 1 });
const image = (name: string): HTMLElement => screen.getByRole('img', { name });
const approve = (): HTMLElement => screen.getByRole('button', { name: 'Approve' });
const deny = (): HTMLElement => screen.getByRole('button', { name: 'Deny' });
const press = (key: string): void => {
  fireEvent.keyDown(window, { key });
};

async function openSnapshot(path: string): Promise<void> {
  renderApp(path);
  await screen.findByRole('tablist', { name: 'Viewer mode' });
}

describe('snapshot images', () => {
  it('show a placeholder until they load', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed');

    expect(image('New')).toHaveClass('snapshot-image', 'is-loading');
    fireEvent.load(image('New'));
    expect(image('New')).toHaveClass('is-loaded');
    expect(image('New')).not.toHaveClass('is-loading');
  });

  it('are new elements on the next snapshot, never the previous one’s pixels', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-new?filter=all');
    loadImages();
    const previous = image('New');
    expect(previous).toHaveAttribute('src', img('1'));

    press('j');
    await waitFor(() => {
      expect(heading()).toHaveTextContent('Button : Primary');
    });

    expect(previous).not.toBeInTheDocument();
    expect(image('New')).not.toBe(previous);
    expect(image('New')).toHaveAttribute('src', img('2'));
    expect(image('New')).toHaveClass('is-loading');
  });

  it('say so when one fails to load, instead of looking like an empty capture', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed');

    fireEvent.error(image('New'));
    fireEvent.load(image('Baseline'));

    expect(image('Could not load the new image')).toHaveTextContent('Could not load the new image');
    expect(screen.queryByRole('img', { name: 'New' })).not.toBeInTheDocument();
    expect(approve()).toBeDisabled();
    expect(deny()).toBeDisabled();
  });
});

describe('review waits for the images on screen', () => {
  it('keeps Approve, Deny and a/d unavailable until both captures have loaded', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed');

    expect(approve()).toBeDisabled();
    expect(deny()).toBeDisabled();
    press('a');
    press('d');
    fireEvent.load(image('Baseline'));
    expect(approve()).toBeDisabled();
    press('a');
    expect(apiState.calls).toEqual([]);

    fireEvent.load(image('New'));
    expect(approve()).toBeEnabled();
    expect(deny()).toBeEnabled();
  });

  it('waits for the diff once it is laid over the new capture', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed');
    loadImages();
    expect(approve()).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
    expect(approve()).toBeDisabled();
    fireEvent.load(image('Diff'));
    expect(approve()).toBeEnabled();
  });

  it('waits only for the image 1 up shows, and for both in the slider', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-changed');
    fireEvent.click(screen.getByRole('tab', { name: '1 up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Baseline' }));

    fireEvent.load(image('Baseline'));
    expect(approve()).toBeEnabled();

    fireEvent.click(screen.getByRole('tab', { name: 'Slider' }));
    expect(approve()).toBeDisabled();
    fireEvent.load(image('New'));
    expect(approve()).toBeEnabled();
  });
});

describe('review after moving to the next snapshot', () => {
  it('closes again on the next snapshot until its images load, then takes a', async () => {
    await openSnapshot('/builds/build-12/snapshots/snap-new?filter=all');
    // A new story has no baseline: its one capture is all there is to see.
    fireEvent.load(image('New'));
    expect(approve()).toBeEnabled();

    press('j');
    await waitFor(() => {
      expect(heading()).toHaveTextContent('Button : Primary');
    });

    expect(approve()).toBeDisabled();
    press('a');
    expect(apiState.calls).toEqual([]);
    loadImages();
    press('a');
    expect(await screen.findByText('Approved Button / Primary')).toBeInTheDocument();
    expect(apiState.calls).toEqual(['POST /api/snapshots/snap-changed/review']);
  });
});
