import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const getCheckoutStatus = vi.fn();
// The spy returns plain values; a { fail } value is thrown here, so the spy
// itself never holds a rejected promise (which vitest reports as unhandled).
vi.mock('@/services/invoiceService', async (orig) => ({
  ...(await orig<any>()),
  getCheckoutStatus: async (...a: any[]) => {
    const r = await getCheckoutStatus(...a);
    if (r && r.fail) throw r.fail;
    return r;
  },
}));

import { checkoutErrorMessage, resolveSaleOutcome, SALE_UNKNOWN_MESSAGE } from './checkout';
import { usePosStore } from '@/store/posStore';
import { readSaleBackup, SALE_BACKUP_KEY, useSaleBackup } from '@/hooks/useSaleBackup';

const noWait = { sleep: async () => {} };
const timeout = { code: 'NETWORK_TIMEOUT', message: 'Request timed out.' };

describe('after a lost checkout response', () => {
  beforeEach(() => getCheckoutStatus.mockReset());

  it('a confirmed sale is reported as completed, with its invoice', async () => {
    getCheckoutStatus.mockResolvedValue({ status: 'confirmed', invoice: { id: 'inv9', invoiceNumber: 'INV-9' }, warranties: [] });
    const outcome = await resolveSaleOutcome('chk-1', noWait);
    expect(outcome).toMatchObject({ kind: 'completed', invoiceId: 'inv9', confirmed: { invoice: { invoiceNumber: 'INV-9' } } });
  });

  it('no invoice or a draft means the sale was not completed', async () => {
    getCheckoutStatus.mockResolvedValueOnce({ status: 'none', invoice: null, warranties: [] });
    expect((await resolveSaleOutcome('chk-1', noWait)).kind).toBe('not_completed');
    getCheckoutStatus.mockResolvedValueOnce({ status: 'draft', invoice: { id: 'd1' }, warranties: [] });
    expect((await resolveSaleOutcome('chk-1', noWait)).kind).toBe('not_completed');
  });

  it('keeps asking while the connection is down, and recovers when it returns', async () => {
    getCheckoutStatus
      .mockReturnValueOnce({ fail: timeout })
      .mockResolvedValueOnce({ status: 'confirmed', invoice: { id: 'inv9' }, warranties: [] });
    expect((await resolveSaleOutcome('chk-1', noWait)).kind).toBe('completed');
    expect(getCheckoutStatus).toHaveBeenCalledTimes(2);
  });

  it('says it cannot tell — never "not completed" — when the server stays unreachable', async () => {
    getCheckoutStatus.mockReturnValue({ fail: timeout });
    expect((await resolveSaleOutcome('chk-1', { ...noWait, attempts: 3 })).kind).toBe('unknown');
    expect(getCheckoutStatus).toHaveBeenCalledTimes(3);
    expect(SALE_UNKNOWN_MESSAGE).toMatch(/may have gone through/);
  });

  it('a connection error is never described as a sale that failed', () => {
    for (const code of ['NETWORK_ERROR', 'NETWORK_TIMEOUT']) {
      expect(checkoutErrorMessage({ code })).not.toMatch(/not completed/i);
      expect(checkoutErrorMessage({ code })).toMatch(/checking whether the sale went through/i);
    }
  });
});

describe('checkout ID', () => {
  afterEach(() => {
    usePosStore.getState().clearCart();
    sessionStorage.clear();
  });

  it('a finished sale gives the next sale a new ID', () => {
    const first = usePosStore.getState().checkoutId;
    expect(first).toEqual(expect.any(String));
    usePosStore.getState().clearCart();
    expect(usePosStore.getState().checkoutId).not.toBe(first);
  });

  it('the sale backup keeps the checkout ID and payment keys across a reload', () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderHook(() => useSaleBackup('u1'));
      usePosStore.setState({
        cart: [{ variantId: 'v1', quantity: 1, unitPrice: 10 } as any],
        payments: [{ id: 'pm-key-1', method: 'cash', amount: 10 } as any],
      });
      vi.advanceTimersByTime(400);
      const saved = readSaleBackup('u1');
      expect(saved?.checkoutId).toBe(usePosStore.getState().checkoutId);
      expect(saved?.payments).toEqual([{ id: 'pm-key-1', method: 'cash', amount: 10 }]);
      unmount();

      // "Reload": empty store, then the backup is restored.
      const checkoutId = saved!.checkoutId;
      usePosStore.getState().clearCart();
      expect(sessionStorage.getItem(SALE_BACKUP_KEY)).not.toBeNull();
      renderHook(() => useSaleBackup('u1'));
      expect(usePosStore.getState().checkoutId).toBe(checkoutId);
      expect(usePosStore.getState().payments).toEqual([{ id: 'pm-key-1', method: 'cash', amount: 10 }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
