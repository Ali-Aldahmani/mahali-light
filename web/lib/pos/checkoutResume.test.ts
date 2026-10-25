import { beforeEach, describe, expect, it, vi } from 'vitest';

// A draft that already has payments (invoice audit F14 / F23).
const api = vi.hoisted(() => ({
  getCheckoutStatus: vi.fn(),
  updateInvoiceItems: vi.fn(),
  getInvoicePayments: vi.fn(),
  removeInvoicePayment: vi.fn(),
  addInvoicePayment: vi.fn(),
  confirmInvoice: vi.fn(),
  createInvoice: vi.fn(),
}));
vi.mock('@/services/invoiceService', () => api);

import { submitSale } from './checkout';

const draft = { items: [], customerId: null, invoiceDiscount: 0, notes: null, checkoutId: 'chk-1' };

describe('completing a resumed draft that already has payments', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.getCheckoutStatus.mockResolvedValue({ status: 'draft', invoice: { id: 'd1' } });
    api.updateInvoiceItems.mockResolvedValue({ invoiceNumber: 'INV-1', updatedAt: '2026-10-25T10:00:00.000Z' });
    api.confirmInvoice.mockResolvedValue({ invoice: { id: 'd1' } });
  });

  it('keeps unchanged allocations, replaces changed ones, and sends the draft version', async () => {
    api.getInvoicePayments.mockResolvedValue([
      { id: 'p-keep', idempotencyKey: 'k-cash', method: 'cash', amount: 50 },
      { id: 'p-old', idempotencyKey: 'k-bank', method: 'bank', amount: 30 },
      { id: 'p-nokey', idempotencyKey: null, method: 'cash', amount: 5 },
    ]);
    const onDraftSaved = vi.fn();
    await submitSale({
      draft,
      draftInvoiceId: 'd1',
      draftUpdatedAt: '2026-10-25T09:00:00.000Z',
      allocations: [
        { id: 'k-cash', method: 'cash', amount: 50 },
        { id: 'k-bank', method: 'bank', amount: 40 },
      ],
      onDraftSaved,
    });

    expect(api.updateInvoiceItems).toHaveBeenCalledWith('d1', expect.objectContaining({
      expectedUpdatedAt: '2026-10-25T09:00:00.000Z',
    }));
    expect(onDraftSaved).toHaveBeenCalledWith('d1', 'INV-1', '2026-10-25T10:00:00.000Z');
    expect(api.removeInvoicePayment.mock.calls.map((c) => c[1]).sort()).toEqual(['p-nokey', 'p-old']);
    expect(api.addInvoicePayment).toHaveBeenCalledTimes(2);
    expect(api.confirmInvoice).toHaveBeenCalledWith('d1');
  });

  it('a new sale never looks for allocations to remove', async () => {
    api.createInvoice.mockResolvedValue({ id: 'n1', invoiceNumber: 'INV-2', status: 'draft' });
    await submitSale({ draft, allocations: [{ id: 'k', method: 'cash', amount: 10 }] });
    expect(api.getInvoicePayments).not.toHaveBeenCalled();
    expect(api.removeInvoicePayment).not.toHaveBeenCalled();
  });
});
