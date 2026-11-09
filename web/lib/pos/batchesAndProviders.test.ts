import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/invoiceService', () => ({}));

import { buildInvoiceItems, samePayment } from './checkout';
import { usePosStore } from '@/store/posStore';

describe('cost batch choice on cart lines', () => {
  beforeEach(() => {
    usePosStore.setState({ cart: [] } as any);
    usePosStore.getState().addToCart({ variantId: 'v1', productId: 'p1', productName: 'Cable', sellingPrice: 10, stockQty: 20 } as any, 3);
  });

  it('sends the chosen batches with the line, and nothing when none were chosen', () => {
    expect(buildInvoiceItems(usePosStore.getState().cart)[0]).not.toHaveProperty('batchSelection');
    usePosStore.getState().setBatchSelection('v1', [{ batchId: 'b1', quantity: 2 }, { batchId: 'b2', quantity: 1 }]);
    expect(buildInvoiceItems(usePosStore.getState().cart)[0].batchSelection)
      .toEqual([{ batchId: 'b1', quantity: 2 }, { batchId: 'b2', quantity: 1 }]);
  });

  it('drops the choice when the quantity changes, so it can never disagree with the line', () => {
    usePosStore.getState().setBatchSelection('v1', [{ batchId: 'b1', quantity: 3 }]);
    usePosStore.getState().updateQty('v1', 3);
    expect(usePosStore.getState().cart[0].batchSelection).toEqual([{ batchId: 'b1', quantity: 3 }]);
    usePosStore.getState().updateQty('v1', 4);
    expect(usePosStore.getState().cart[0].batchSelection).toBeNull();
  });

  it('drops the choice when the same product is added again', () => {
    usePosStore.getState().setBatchSelection('v1', [{ batchId: 'b1', quantity: 3 }]);
    usePosStore.getState().addToCart({ variantId: 'v1', productId: 'p1', productName: 'Cable', sellingPrice: 10, stockQty: 20 } as any, 1);
    expect(usePosStore.getState().cart[0].batchSelection).toBeNull();
  });
});

describe('card provider on a payment', () => {
  const stored = { method: 'bank', tender: 'card', bankAccountId: 'a1', reference: null, amount: 50, providerId: 'p1' };

  it('treats a card payment on another provider as a different payment', () => {
    expect(samePayment({ id: 'x', method: 'card', amount: 50, bankAccountId: 'a1', providerId: 'p1' }, stored)).toBe(true);
    expect(samePayment({ id: 'x', method: 'card', amount: 50, bankAccountId: 'a1', providerId: 'p2' }, stored)).toBe(false);
  });

  it('ignores providers for transfers', () => {
    expect(samePayment(
      { id: 'x', method: 'transfer', amount: 50, bankAccountId: 'a1' },
      { ...stored, tender: 'transfer', providerId: null },
    )).toBe(true);
  });
});
