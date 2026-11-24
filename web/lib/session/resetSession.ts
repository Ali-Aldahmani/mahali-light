import { usePosStore } from '@/store/posStore';
import { clearLegacyBrowserCaches } from './legacyCaches';

// Run on every sign-out (authStore.logoutLocal). The next person to sign in
// on this screen must not inherit the previous cashier's cart, customer,
// payments, draft invoice or checkout ID (engineering audit F-FE-06): after
// an idle sign-out they could otherwise complete that sale, on that
// customer's credit, under their own name.
//
// The tab's sale backup (hooks/useSaleBackup.ts) is kept: it is tied to the
// user who made it, so the same cashier signing back in gets the sale back
// and anyone else does not.
export function resetSessionStores() {
  try {
    usePosStore.getState().clearCart();
  } catch (_e) {
    /* store not initialised */
  }
  clearLegacyBrowserCaches();
}
