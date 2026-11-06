import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmButton } from './ConfirmButton.js';
import { CrashPanel } from './CrashPanel.js';
import { formatPercent, plural } from './format.js';

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
