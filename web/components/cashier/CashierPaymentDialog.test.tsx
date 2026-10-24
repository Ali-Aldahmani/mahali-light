import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import CashierPaymentDialog from './CashierPaymentDialog';

function renderDialog(total: number, payments = [{ id: 'p1', method: 'cash', amount: total }]) {
  render(
    <CashierPaymentDialog
      open
      total={total}
      customer={null}
      payments={payments}
      submitting={false}
      error={null}
      onAdd={vi.fn()}
      onUpdate={vi.fn()}
      onRemove={vi.fn()}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  return screen.getByRole('button', { name: /complete sale/i });
}

describe('cashier payment dialog', () => {
  afterEach(cleanup);

  it('lets the cashier complete a fully discounted (zero-total) sale', () => {
    expect(renderDialog(0)).toBeEnabled();
  });

  it('still blocks a guest sale that is not paid in full', () => {
    expect(renderDialog(100, [{ id: 'p1', method: 'cash', amount: 40 }])).toBeDisabled();
  });
});
