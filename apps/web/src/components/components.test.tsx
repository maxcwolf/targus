import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmButton } from './ConfirmButton.js';
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
});

describe('format', () => {
  it('formats ratios and plurals', () => {
    expect(formatPercent(0.0123)).toBe('1.23%');
    expect(plural(1, 'change')).toBe('1 change');
    expect(plural(3, 'change')).toBe('3 changes');
  });
});
