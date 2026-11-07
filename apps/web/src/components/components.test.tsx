import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmButton } from './ConfirmButton.tsx';
import { CrashPanel } from './CrashPanel.tsx';
import { formatPercent, plural } from './format.ts';
import { SnapshotImage } from './SnapshotImage.tsx';

describe('ConfirmButton', () => {
  it('needs a second click and can be cancelled', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Go" confirmLabel="Confirm: go" onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: go' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });

  it('is disabled while busy', () => {
    render(<ConfirmButton label="Go" confirmLabel="Confirm" busy onConfirm={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
  });

  it('is primary by default and stays outlined through both steps as secondary', () => {
    const { unmount } = render(
      <ConfirmButton label="Go" confirmLabel="Confirm" onConfirm={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Go' })).toHaveClass('primary');
    unmount();

    render(
      <ConfirmButton
        label="Go"
        title="Does the thing"
        confirmLabel="Confirm"
        variant="secondary"
        onConfirm={vi.fn()}
      />,
    );
    const first = screen.getByRole('button', { name: 'Go' });
    expect(first).not.toHaveClass('primary');
    expect(first).toHaveAttribute('title', 'Does the thing');
    fireEvent.click(first);
    expect(screen.getByRole('button', { name: 'Confirm' })).not.toHaveClass('primary');
  });
});

describe('format', () => {
  it('formats ratios and plurals', () => {
    expect(formatPercent(0.0123)).toBe('1.23%');
    expect(plural(1, 'change')).toBe('1 change');
    expect(plural(3, 'change')).toBe('3 changes');
  });
});

describe('CrashPanel', () => {
  it('shows a plain message and reloads on request', () => {
    const onReload = vi.fn();
    render(<CrashPanel onReload={onReload} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(onReload).toHaveBeenCalledOnce();
  });
});

describe('SnapshotImage', () => {
  it('loads without a listener, and names an unlabelled image that fails', () => {
    const { container } = render(<SnapshotImage src="/a.png" alt="" />);
    const image = container.querySelector('img');
    if (!image) throw new Error('expected an img');

    fireEvent.load(image);
    expect(image).toHaveClass('is-loaded');
    fireEvent.error(image);
    expect(screen.getByRole('img', { name: 'Could not load this image' })).toBeInTheDocument();
  });

  it('starts over, as a placeholder, when its src changes', () => {
    const { container, rerender } = render(<SnapshotImage src="/a.png" alt="Thumb" />);
    const first = container.querySelector('img');
    if (!first) throw new Error('expected an img');
    fireEvent.load(first);

    rerender(<SnapshotImage src="/b.png" alt="Thumb" />);

    expect(first).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Thumb' })).toHaveClass('is-loading');
  });
});
