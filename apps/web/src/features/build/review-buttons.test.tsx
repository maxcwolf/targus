import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { hash, initialSnapshots } from '../../test/fixtures.ts';
import { apiError, apiState, server } from '../../test/msw.ts';
import { renderApp } from '../../test/render.tsx';

const review = (id: string): string | undefined =>
  apiState.snapshots.find((snapshot) => snapshot.id === id)?.review;

/** A second unreviewed Button story beside Button : Primary. */
function addSecondary(): void {
  const primary = initialSnapshots().find((snapshot) => snapshot.id === 'snap-changed');
  if (primary === undefined) throw new Error('the fixtures have no changed snapshot');
  apiState.snapshots.push({
    ...primary,
    id: 'snap-secondary',
    storyId: 'button--secondary',
    name: 'Secondary',
    imageHash: hash('e'),
  });
}

async function group(name: string): Promise<HTMLElement> {
  renderApp('/builds/build-12?filter=all');
  return screen.findByRole('rowgroup', { name });
}

describe('a component row', () => {
  it('approves every unreviewed story of the component in one request', async () => {
    addSecondary();
    const buttons = await group('Button');

    fireEvent.click(within(buttons).getByRole('button', { name: 'Approve Button' }));

    await waitFor(() => {
      expect(within(buttons).queryByRole('button', { name: 'Approve Button' })).toBeNull();
    });
    expect(apiState.calls).toEqual(['POST /api/builds/build-12/review']);
    expect([review('snap-changed'), review('snap-secondary')]).toEqual(['approved', 'approved']);
    expect(review('snap-new')).toBe('pending');
  });

  it('says how many it decides, and denies them', async () => {
    addSecondary();
    const buttons = await group('Button');
    const deny = within(buttons).getByRole('button', { name: 'Deny Button' });

    expect(deny).toHaveTextContent('Deny 2');
    expect(within(buttons).getByRole('button', { name: 'Approve Button' })).toHaveTextContent(
      'Approve 2',
    );
    fireEvent.click(deny);

    await waitFor(() => {
      expect([review('snap-changed'), review('snap-secondary')]).toEqual(['denied', 'denied']);
    });
  });

  it('has no buttons once nothing under it is unreviewed', async () => {
    const card = await group('Card');

    expect(within(card).queryByRole('button', { name: 'Approve Card' })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Approve Default' })).toBeInTheDocument();
  });
});

describe('a story row', () => {
  it('approves or denies that story, and presses the decision it has', async () => {
    const card = await group('Card');
    const approve = within(card).getByRole('button', { name: 'Approve Default' });
    const deny = within(card).getByRole('button', { name: 'Deny Default' });

    expect(approve).toHaveAttribute('aria-pressed', 'true');
    expect(approve).toBeDisabled();
    expect(deny).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(deny);

    // Both wait for the request and the re-read of the build; then Deny is the pressed one.
    await waitFor(() => {
      expect(within(card).getByRole('button', { name: 'Approve Default' })).toBeEnabled();
    });
    expect(review('snap-approved')).toBe('denied');
    expect(within(card).getByRole('button', { name: 'Deny Default' })).toBeDisabled();
    expect(within(card).getByRole('button', { name: 'Deny Default' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('has no buttons for a story that needs no review', async () => {
    const text = await group('Text');

    expect(within(text).queryByRole('button', { name: /Approve|Deny/ })).not.toBeInTheDocument();
    expect(within(text).getByRole('link', { name: 'Open snapshot' })).toBeInTheDocument();
  });

  it('shows the API error when the decision fails', async () => {
    server.use(
      http.post('*/api/builds/:buildId/review', () =>
        apiError(409, 'conflict', 'build build-12 is being reviewed concurrently; retry'),
      ),
    );
    const buttons = await group('Button');

    fireEvent.click(within(buttons).getByRole('button', { name: 'Approve Primary' }));

    expect(await within(buttons).findByRole('alert')).toHaveTextContent(
      'build build-12 is being reviewed concurrently; retry',
    );
    expect(review('snap-changed')).toBe('pending');
  });
});
