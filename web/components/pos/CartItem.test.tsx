// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CartItem from './CartItem';

vi.mock('@/components/pos/CartBatchPicker', () => ({ default: () => null }));

const baseItem = {
  variantId: 1,
  productName: 'product 1',
  sku: 'LGH-GNX-0001',
  quantity: 3,
  unitPrice: 100,
  discountPercent: 0,
  discountAmount: 0,
};

function setup(item: any = baseItem) {
  const onDiscountChange = vi.fn();
  render(
    <CartItem item={item} onQtyChange={() => {}} onDiscountChange={onDiscountChange} onRemove={() => {}} />,
  );
  return {
    onDiscountChange,
    percent: screen.getByLabelText('Discount percent for product 1'),
    amount: screen.getByLabelText('Discount amount in AED for product 1'),
  };
}

describe('CartItem line discount steppers', () => {
  it('sends a typed percent, and an AED amount with cents', () => {
    const { onDiscountChange, percent, amount } = setup();
    fireEvent.change(percent, { target: { value: '12.5' } });
    expect(onDiscountChange).toHaveBeenLastCalledWith({ percent: 12.5 });
    fireEvent.change(amount, { target: { value: '25.75' } });
    expect(onDiscountChange).toHaveBeenLastCalledWith({ amount: 25.75 });
  });

  it('steps a whole unit per + press', () => {
    const { onDiscountChange } = setup();
    fireEvent.click(screen.getByLabelText('Increase Discount percent for product 1'), { detail: 0 });
    expect(onDiscountChange).toHaveBeenLastCalledWith({ percent: 1 });
    fireEvent.click(screen.getByLabelText('Increase Discount amount in AED for product 1'), { detail: 0 });
    expect(onDiscountChange).toHaveBeenLastCalledWith({ amount: 1 });
  });

  it('caps the percent at 100 and the amount at the line subtotal', () => {
    const { onDiscountChange, percent, amount } = setup();
    fireEvent.change(percent, { target: { value: '150' } });
    fireEvent.blur(percent);
    expect(onDiscountChange).toHaveBeenLastCalledWith({ percent: 100 });
    fireEvent.change(amount, { target: { value: '999' } });
    fireEvent.blur(amount);
    expect(onDiscountChange).toHaveBeenLastCalledWith({ amount: 300 });
  });

  it('caps at a pricing restriction, scaling the per-unit amount by quantity', () => {
    const { onDiscountChange, percent, amount } = setup({
      ...baseItem,
      pricingRestriction: { maxDiscountPercent: 10, maxDiscountAmount: 5 },
    });
    fireEvent.change(percent, { target: { value: '40' } });
    fireEvent.blur(percent);
    expect(onDiscountChange).toHaveBeenLastCalledWith({ percent: 10 });
    fireEvent.change(amount, { target: { value: '40' } });
    fireEvent.blur(amount);
    expect(onDiscountChange).toHaveBeenLastCalledWith({ amount: 15 });
  });
});
