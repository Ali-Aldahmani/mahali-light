import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import CashierModeEntry from './CashierModeEntry';

describe('CashierModeEntry', () => {
  it('navigates to the existing cashier route with an accessible name', () => {
    render(<CashierModeEntry />);
    const link = screen.getByRole('link', { name: 'Enter Cashier Mode' });
    expect(link).toHaveAttribute('href', '/cashier');
    expect(link).toHaveAttribute('title', 'Open the full-screen cashier workspace');
  });

  it('does not force browser fullscreen and stays a single entry control', () => {
    const { container } = render(<CashierModeEntry />);
    expect(container.querySelectorAll('a[href="/cashier"]')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
