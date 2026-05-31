import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx';
import { useSocketStore } from '../../store/socketStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { useInventoryStore } from '../../store/inventoryStore.js';
import { useSupplierStore } from '../../store/supplierStore.js';
import { useCustomerStore } from '../../store/customerStore.js';
import { useInvoiceStore } from '../../store/invoiceStore.js';
import { useWarrantyStore } from '../../store/warrantyStore.js';
import { useReturnStore } from '../../store/returnStore.js';
import { useTreasuryStore } from '../../store/treasuryStore.js';
import { useAttendanceStore } from '../../store/attendanceStore.js';
import { useBillStore } from '../../store/billStore.js';
import { useNotificationStore } from '../../store/notificationStore.js';
import { useBackupStore } from '../../store/backupStore.js';
import RestoreOverlay from '../backup/RestoreOverlay.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import GlobalErrorShell from '../errors/GlobalErrorShell.jsx';
import { initStockCache } from '../../services/stockCacheService.js';
import { syncAllCaches } from '../../services/localCacheService.js';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts.js';
import KeyboardShortcutOverlay from '../errors/KeyboardShortcutOverlay.jsx';
import { useAppSettingsStore } from '../../store/appSettingsStore.js';
import {
  onAdjustmentEvent,
  onCustomerBalanceUpdate,
  onInvoiceEditRequestEvent,
  onInvoiceEvent,
  onPurchaseOrderEvent,
  onReorderAlert,
  onStockUpdate,
  onSupplierReturnEvent,
  onWarrantyEvent,
  onWarrantyClaimEvent,
  onReturnEvent,
  onTreasuryEvent,
  onAttendanceEvent,
  onLeaveEvent,
  onCorrectionEvent,
  onBillEvent,
  onExpenseEvent,
} from '../../store/socketStore.js';

const TITLES = {
  '/dashboard': 'Dashboard',
  '/team': 'Team',
  '/users': 'Team',
  '/employees': 'Team',
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
  '/pos': 'POS',
  '/invoices': 'Invoices',
  '/invoices/edit-requests': 'Edit requests',
  '/settings/printers': 'Printers & branding',
  '/warranties/lookup': 'Warranty lookup',
  '/warranties': 'Warranties',
  '/warranty-claims': 'Warranty claims',
  '/returns': 'Returns',
  '/returns/new': 'New return request',
  '/returns/requests': 'Return request',
  '/returns/orders': 'Return order',
  '/treasury': 'Treasury',
  '/attendance': 'Attendance',
  '/attendance/leave-balances': 'Leave balances',
  '/attendance/holidays': 'Holidays',
  '/expenses': 'Bills & expenses',
  '/expenses/bills': 'Bill',
  '/finance': 'Finance',
  '/finance/journal': 'Journal entries',
  '/finance/accounts': 'Chart of accounts',
  '/finance/periods': 'Financial periods',
  '/reports': 'Reports',
  '/reports/net-profit': 'Net profit',
  '/reports/scheduled': 'Scheduled reports',
  '/analytics': 'Analytics',
  '/approvals': 'Approvals',
  '/settings': 'Settings',
  '/settings/notifications': 'Notification preferences',
  '/settings/backup': 'Backup & restore',
  '/admin/bug-reports': 'Bug reports',
  '/admin/error-logs': 'Error logs',
};

export default function AppLayout() {
  const location = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  const token = useAuthStore((s) => s.token);
  const fetchAppSettings = useAppSettingsStore((s) => s.fetchPublic);
  useKeyboardShortcuts({ onToggleHelp: () => setHelpOpen((v) => !v) });
  const permissions = useAuthStore((s) => s.user?.permissions || []);
  const connect = useSocketStore((s) => s.connect);
  const disconnect = useSocketStore((s) => s.disconnect);
  const refreshInventory = useInventoryStore((s) => s.refreshAll);
  const refreshAlerts = useInventoryStore((s) => s.refreshAlerts);
  const refreshAdjustments = useInventoryStore((s) => s.refreshAdjustmentsBadge);
  const refreshSupplierSummary = useSupplierStore((s) => s.refreshSummary);
  const refreshCustomerSummary = useCustomerStore((s) => s.refreshSummary);
  const refreshInvoiceSummary = useInvoiceStore((s) => s.refreshSummary);
  const refreshEditRequestsCount = useInvoiceStore(
    (s) => s.refreshEditRequestsCount,
  );
  const refreshWarrantySummary = useWarrantyStore((s) => s.refresh);
  const refreshReturnSummary = useReturnStore((s) => s.refresh);
  const refreshTreasury = useTreasuryStore((s) => s.refresh);
  const refreshTreasuryDrawer = useTreasuryStore((s) => s.refreshDrawer);
  const refreshAttendanceToday = useAttendanceStore((s) => s.refreshToday);
  const refreshAttendancePending = useAttendanceStore((s) => s.refreshPending);
  const applyAttendanceEvent = useAttendanceStore((s) => s.applyAttendanceEvent);
  const refreshUpcomingBills = useBillStore((s) => s.refreshUpcoming);
  const refreshExpenseSummary = useBillStore((s) => s.refreshExpenseSummary);
  const fetchUnreadCount = useNotificationStore((s) => s.fetchUnreadCount);
  const fetchApprovalCount = useNotificationStore((s) => s.fetchApprovalCount);
  const fetchPreferences = useNotificationStore((s) => s.fetchPreferences);
  const resetNotifications = useNotificationStore((s) => s.reset);
  const fetchMaintenance = useBackupStore((s) => s.fetchMaintenance);

  useEffect(() => {
    if (!token) return undefined;
    connect();
    const hasStock =
      permissions.includes('stock.view') || permissions.includes('*');
    if (hasStock) {
      initStockCache({ force: true }).catch(() => {});
      syncAllCaches().catch(() => {});
      refreshInventory();
    }
    fetchAppSettings?.().catch(() => {});
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
    const hasInvoice =
      permissions.includes('invoice.view') || permissions.includes('*');
    if (hasInvoice) {
      refreshInvoiceSummary?.();
    }
    const hasInvoiceApprove =
      permissions.includes('invoice.edit_approve') ||
      permissions.includes('*');
    if (hasInvoiceApprove) {
      refreshEditRequestsCount?.();
    }
    const hasWarranty =
      permissions.includes('warranty.view') || permissions.includes('*');
    if (hasWarranty) {
      refreshWarrantySummary?.();
    }
    const hasReturn =
      permissions.includes('return.request') || permissions.includes('*');
    if (hasReturn) {
      refreshReturnSummary?.();
    }
    const hasCashView =
      permissions.includes('cash.view') || permissions.includes('*');
    if (hasCashView) {
      refreshTreasury?.();
    }
    const hasAttendanceViewAll =
      permissions.includes('attendance.view_all') || permissions.includes('*');
    if (hasAttendanceViewAll) {
      refreshAttendanceToday?.();
      refreshAttendancePending?.();
    }
    const hasBillView =
      permissions.includes('bills.view') || permissions.includes('*');
    if (hasBillView) {
      refreshUpcomingBills?.();
      refreshExpenseSummary?.();
    }

    // Phase 16 — bootstrap notification state.
    fetchPreferences?.();
    fetchUnreadCount?.();
    // Phase 17 — pick up an in-progress restore so a freshly opened tab
    // shows the overlay immediately.
    fetchMaintenance?.();
    const isManagerOrAdmin =
      permissions.includes('*') ||
      ['Manager', 'Admin'].includes(useAuthStore.getState().user?.role);
    if (isManagerOrAdmin) {
      fetchApprovalCount?.();
    }
    // Periodic refresh of approval count (live updates also nudge it).
    const approvalsTimer = isManagerOrAdmin
      ? setInterval(() => fetchApprovalCount?.(), 60_000)
      : null;

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
    const unsubG = onInvoiceEvent(() => refreshInvoiceSummary?.());
    const unsubI = onWarrantyEvent(() => refreshWarrantySummary?.());
    const unsubJ = onWarrantyClaimEvent(() => refreshWarrantySummary?.());
    const unsubK = onReturnEvent(() => refreshReturnSummary?.());
    const unsubL = onTreasuryEvent((p) => {
      if (
        p.kind === 'drawer_opened' ||
        p.kind === 'drawer_closed'
      ) {
        refreshTreasuryDrawer?.();
      } else if (p.kind === 'cash_balance' || p.kind === 'bank_balance') {
        // Lightweight: store handles deltas itself; only refresh occasionally.
        if (hasCashView) refreshTreasuryDrawer?.();
      }
    });
    const unsubH = onInvoiceEditRequestEvent(() =>
      refreshEditRequestsCount?.(),
    );
    const unsubM = onAttendanceEvent((p) => {
      if (p.kind === 'checked_in' || p.kind === 'checked_out') {
        applyAttendanceEvent?.(p);
      } else if (p.kind === 'day_finalized') {
        refreshAttendanceToday?.();
      }
    });
    const unsubN = onLeaveEvent(() => refreshAttendancePending?.());
    const unsubO = onCorrectionEvent(() => refreshAttendancePending?.());
    const unsubP = onBillEvent(() => refreshUpcomingBills?.());
    const unsubQ = onExpenseEvent(() => refreshExpenseSummary?.());

    return () => {
      unsubA();
      unsubB();
      unsubC();
      unsubD();
      unsubE();
      unsubF();
      unsubG();
      unsubH();
      unsubI();
      unsubJ();
      unsubK();
      unsubL();
      unsubM();
      unsubN();
      unsubO();
      unsubP();
      unsubQ();
      if (throttleTimer) clearTimeout(throttleTimer);
      if (approvalsTimer) clearInterval(approvalsTimer);
      resetNotifications?.();
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
        <GlobalErrorShell>
          <main className="flex-1 overflow-y-auto px-8 py-6">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </main>
        </GlobalErrorShell>
      </div>
      <RestoreOverlay />
      <KeyboardShortcutOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
