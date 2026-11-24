import { beforeEach, describe, expect, it } from 'vitest';
import { clearLegacyBrowserCaches } from './legacyCaches';
import { useAuthStore } from '@/store/authStore';
import { usePosStore } from '@/store/posStore';

describe('clearLegacyBrowserCaches (F-FE-05)', () => {
  beforeEach(() => localStorage.clear());

  it('removes the old catalogue, customer and stock copies and nothing else', () => {
    localStorage.setItem('mahali.cache.customers.v1', JSON.stringify([{ name: 'A', phone: '050' }]));
    localStorage.setItem('mahali.cache.products.v1', '[]');
    localStorage.setItem('mahali.cache.meta.v1', '{}');
    localStorage.setItem('mahali.stockCache.v1', '{}');
    localStorage.setItem('mahali.browserPcId', 'web-123');
    localStorage.setItem('mahali-light.shortcuts', '{}');

    expect(clearLegacyBrowserCaches()).toBe(4);
    expect(Object.keys(localStorage).sort()).toEqual(['mahali-light.shortcuts', 'mahali.browserPcId']);
  });
});

describe('sign-out resets the sale (F-FE-06)', () => {
  it('the next cashier starts with an empty cart, no customer and a new checkout ID', () => {
    const pos = usePosStore.getState();
    usePosStore.setState({
      cart: [{ variantId: 'v1', quantity: 2 }] as any,
      selectedCustomer: { id: 'c1', name: 'Credit customer' } as any,
      payments: [{ id: 'p1', method: 'credit', amount: 50 }] as any,
      draftInvoiceId: 'inv-1',
      notes: 'note',
    });
    const checkoutBefore = usePosStore.getState().checkoutId;
    useAuthStore.setState({ token: 't', user: { id: 'u1' } as any, sessionKey: 'u1:1' });

    useAuthStore.getState().logoutLocal();

    const after = usePosStore.getState();
    expect(useAuthStore.getState().token).toBeNull();
    expect(after.cart).toEqual([]);
    expect(after.selectedCustomer).toBeNull();
    expect(after.payments).toEqual([]);
    expect(after.draftInvoiceId).toBeNull();
    expect(after.notes).toBe('');
    expect(after.checkoutId).not.toBe(checkoutBefore);
    expect(pos).toBeTruthy();
  });
});
