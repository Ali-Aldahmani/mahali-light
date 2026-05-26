import { useEffect, useMemo } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx';
import { useSocketStore } from '../../store/socketStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { useInventoryStore } from '../../store/inventoryStore.js';
import { useSupplierStore } from '../../store/supplierStore.js';
import { useCustomerStore } from '../../store/customerStore.js';
import { initStockCache } from '../../services/stockCacheService.js';
import {
  onAdjustmentEvent,
  onCustomerBalanceUpdate,
  onPurchaseOrderEvent,
  onReorderAlert,
  onStockUpdate,
  onSupplierReturnEvent,
} from '../../store/socketStore.js';

const TITLES = {
  '/dashboard': 'Dashboard',
  '/users': 'Users',
  '/employees': 'Employees',
  '/roles': 'Roles & Permissions',
  '/products': 'Products',
  '/products/new': 'New product',
  '/categories': 'Categories',
  '/attributes': 'Attributes',
  '/inventory': 'Inventory',
  '/inventory/movements': 'Stock movements',
  '/inventory/counts': 'Stock count',
  '/suppliers': 'Suppliers',
  '/purchase-orders': 'Purchase orders',
  '/purchase-orders/new': 'New purchase order',
  '/customers': 'Customers',
  '/customers/outstanding': 'Outstanding receivables',
};

export default function AppLayout() {
  const location = useLocation();
  const token = useAuthStore((s) => s.token);
  const permissions = useAuthStore((s) => s.user?.permissions || []);
  const connect = useSocketStore((s) => s.connect);
  const disconnect = useSocketStore((s) => s.disconnect);
  const refreshInventory = useInventoryStore((s) => s.refreshAll);
  const refreshAlerts = useInventoryStore((s) => s.refreshAlerts);
  const refreshAdjustments = useInventoryStore((s) => s.refreshAdjustmentsBadge);
  const refreshSupplierSummary = useSupplierStore((s) => s.refreshSummary);
  const refreshCustomerSummary = useCustomerStore((s) => s.refreshSummary);

  useEffect(() => {
    if (!token) return undefined;
    connect();
    const hasStock =
      permissions.includes('stock.view') || permissions.includes('*');
    if (hasStock) {
      initStockCache({ force: true }).catch(() => {});
      refreshInventory();
    }
    const hasSupplier =
      permissions.includes('supplier.view') || permissions.includes('*');
    if (hasSupplier) {
      refreshSupplierSummary?.();
    }
    const hasCustomer =
      permissions.includes('customer.view') || permissions.includes('*');
    if (hasCustomer) {
      refreshCustomerSummary?.();
    }

    // Keep sidebar badges in sync with realtime events. Throttle the
    // heavyweight inventory refresh so a busy POS session doesn't hammer it.
    let throttleTimer = null;
    const throttledRefresh = () => {
      if (throttleTimer) return;
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        refreshInventory?.();
      }, 2000);
    };
    const unsubA = onAdjustmentEvent(() => refreshAdjustments?.());
    const unsubB = onReorderAlert(() => refreshAlerts?.());
    const unsubC = onStockUpdate(throttledRefresh);
    const unsubD = onPurchaseOrderEvent(() => refreshSupplierSummary?.());
    const unsubE = onSupplierReturnEvent(() => refreshSupplierSummary?.());
    const unsubF = onCustomerBalanceUpdate(() => refreshCustomerSummary?.());

    return () => {
      unsubA();
      unsubB();
      unsubC();
      unsubD();
      unsubE();
      unsubF();
      if (throttleTimer) clearTimeout(throttleTimer);
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const title = useMemo(() => {
    // Pick the longest matching prefix so /products/new wins over /products.
    const match = Object.keys(TITLES)
      .filter((k) => location.pathname.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    return match ? TITLES[match] : '';
  }, [location.pathname]);

  return (
    <div className="h-screen flex bg-bg">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={title} />
        <main className="flex-1 overflow-y-auto px-8 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
