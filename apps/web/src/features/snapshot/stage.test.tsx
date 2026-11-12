import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { apiState } from '../../test/msw.ts';
import { renderApp } from '../../test/render.tsx';

// jsdom never loads an image, so these tests give each one a size and fire `load` by hand.

const image = (name: string): HTMLImageElement =>
  screen.getByRole<HTMLImageElement>('img', { name });

function load(name: string, width: number, height: number): void {
  const element = image(name);
  Object.defineProperty(element, 'naturalWidth', { value: width });
  Object.defineProperty(element, 'naturalHeight', { value: height });
  fireEvent.load(element);
}

async function openChanged(): Promise<HTMLElement> {
  apiState.snapshots = apiState.snapshots.map((snapshot) =>
    snapshot.id === 'snap-changed' ? { ...snapshot, width: 840, height: 290 } : snapshot,
  );
  const { container } = renderApp('/builds/build-12/snapshots/snap-changed');
  await screen.findByRole('tablist', { name: 'Viewer mode' });
  return container;
}

const stages = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>('.stage'),
];

describe('captures of different sizes', () => {
  it('share one canvas at one scale, each at its own share of it', async () => {
    const container = await openChanged();
    load('New', 840, 290);
    load('Baseline', 600, 400);

    for (const stage of stages(container)) {
      expect(stage.style.getPropertyValue('--w')).toBe('840');
      expect(stage.style.getPropertyValue('--h')).toBe('400');
    }
    expect(image('Baseline')).toHaveStyle({ width: '71.43%', height: '100%' });
    expect(image('New')).toHaveStyle({ width: '100%', height: '72.5%' });
    expect(screen.getByRole('note')).toHaveTextContent(
      'Size changed 600 × 400 → 840 × 290 px. Both are shown at one scale, aligned top left.',
    );
  });

  it('lay the diff over the whole canvas, as changed pixels only', async () => {
    const container = await openChanged();
    load('New', 840, 290);
    load('Baseline', 600, 400);
    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
    load('Diff', 840, 400);

    expect(image('Diff')).toHaveClass('layer', 'diff-layer');
    expect(image('Diff')).toHaveStyle({ width: '100%', height: '100%' });
    expect(container.querySelector('filter#targus-diff-key feColorMatrix')).toHaveAttribute(
      'values',
      expect.stringMatching(/4 -4 0 0 0$/),
    );
  });

  it('are each cut where the slider crosses them, so neither shows through the other', async () => {
    await openChanged();
    fireEvent.click(screen.getByRole('tab', { name: 'Slider' }));
    load('New', 840, 290);
    load('Baseline', 420, 290);

    fireEvent.change(screen.getByRole('slider', { name: 'Reveal baseline' }), {
      target: { value: '25' },
    });
    expect(image('Baseline').style.clipPath).toBe('inset(0 50% 0 0)');
    expect(image('New').style.clipPath).toBe('inset(0 0 0 25%)');
  });
});

describe('captures of the same size', () => {
  it('fill the canvas, with no size note', async () => {
    const container = await openChanged();
    load('New', 840, 290);
    load('Baseline', 840, 290);

    expect(image('Baseline')).toHaveStyle({ width: '100%', height: '100%' });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(container.querySelector('.stage-unsized')).not.toBeInTheDocument();
  });
});

describe('a capture with no known size', () => {
  it('sits in a placeholder until it loads', async () => {
    const { container } = renderApp('/builds/build-12/snapshots/snap-removed?filter=removed');
    await screen.findByRole('tablist', { name: 'Viewer mode' });

    expect(container.querySelector('.stage')).toHaveClass('stage-unsized');
    load('Baseline', 300, 200);
    expect(container.querySelector('.stage')).not.toHaveClass('stage-unsized');
  });
});

describe('diff styles', () => {
  const style = (name: string): HTMLElement => screen.getByRole('button', { name });

  it('offers highlight, focus and strobe once Diff is on, and keeps the choice', async () => {
    await openChanged();
    expect(screen.queryByRole('group', { name: 'Diff style' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
    expect(style('Highlight')).toHaveAttribute('aria-pressed', 'true');
    expect(image('Diff')).toHaveClass('diff-layer', 'diff-highlight');

    fireEvent.click(style('Focus'));
    expect(style('Focus')).toHaveAttribute('aria-pressed', 'true');
    expect(image('Diff')).toHaveClass('diff-focus');
    expect(image('Diff')).not.toHaveClass('diff-highlight');

    fireEvent.click(style('Strobe'));
    expect(image('Diff')).toHaveClass('diff-strobe');

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
    expect(style('Strobe')).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks the changes in the slider too, and review waits for that image', async () => {
    await openChanged();
    fireEvent.click(screen.getByRole('tab', { name: 'Slider' }));
    load('New', 840, 290);
    load('Baseline', 840, 290);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
    expect(image('Diff')).toHaveStyle({ width: '100%', opacity: '0.6' });
    expect(image('Diff').style.clipPath).toBe('');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    load('Diff', 840, 290);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });
});
