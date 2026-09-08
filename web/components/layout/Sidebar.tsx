'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Boxes,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileEdit,
  FolderTree,
  LayoutDashboard,
  Package,
  Receipt,
  RotateCcw,
  Shield,
  ShoppingCart,
  Truck,
  UsersRound,
  Users,
  Banknote,
  CalendarClock,
  Zap,
  LineChart,
  BarChart3,
  Activity,
  CheckSquare,
  Settings,
  Bug,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useInventoryStore } from '@/store/inventoryStore';
import { useSupplierStore } from '@/store/supplierStore';
import { useCustomerStore } from '@/store/customerStore';
import { useInvoiceStore } from '@/store/invoiceStore';
import { useWarrantyStore } from '@/store/warrantyStore';
import { useReturnStore } from '@/store/returnStore';
import { useAttendanceStore } from '@/store/attendanceStore';
import { useBillStore } from '@/store/billStore';
import { useNotificationStore } from '@/store/notificationStore';
import { useAppSettingsStore } from '@/store/appSettingsStore';
import { useUiErrorStore } from '@/store/uiErrorStore';
import SidebarBadge from './SidebarBadge';
import AppVersion from '../settings/AppVersion';
import { cn } from '@/lib/utils/cn';

type NavItem = {
  to?: string;
  label?: string;
  icon?: LucideIcon;
  permission?: string | null;
  anyPermissions?: string[];
  anyRoles?: string[];
  badge?: string;
  badgeTone?: string;
  section?: string;
};

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: null },
  { to: '/pos', label: 'POS', icon: ShoppingCart, permission: 'invoice.create' },
  { section: 'Sales' },
  { to: '/invoices', label: 'Invoices', icon: Receipt, permission: 'invoice.view' },
  { to: '/inventory', label: 'Inventory', icon: Boxes, permission: 'stock.view', badge: 'inventory', badgeTone: 'warning' },
  { to: '/products', label: 'Products', icon: Package, permission: 'product.view' },
  { section: 'Partners' },
  { to: '/suppliers', label: 'Suppliers', icon: Building2, permission: 'supplier.view' },
  { to: '/customers', label: 'Customers', icon: Users, permission: 'customer.view' },
  { section: 'Service' },
  { to: '/warranties', label: 'Warranties', icon: Shield, permission: 'warranty.view' },
  { to: '/returns', label: 'Returns', icon: RotateCcw, permission: 'return.request', badge: 'returnsPending', badgeTone: 'warning' },
  { section: 'Finance' },
  { to: '/treasury', label: 'Treasury', icon: Banknote, permission: 'cash.view' },
  { to: '/expenses', label: 'Bills & expenses', icon: Receipt, permission: 'bills.view', badge: 'billsAttention', badgeTone: 'error' },
  { to: '/finance', label: 'Finance', icon: LineChart, permission: 'finance.view_dashboard' },
  { to: '/reports', label: 'Reports', icon: BarChart3, anyPermissions: ['report.financial', 'report.sales', 'report.inventory', '*'] },
  { to: '/analytics', label: 'Analytics', icon: Activity, anyPermissions: ['analytics.view', '*'] },
  { section: 'People' },
  { to: '/team', label: 'Team', icon: UsersRound, anyPermissions: ['user.edit', 'employee.view'] },
  { to: '/attendance', label: 'Attendance', icon: CalendarClock, permission: 'attendance.view_own' },
  { section: 'More' },
  { to: '/approvals', label: 'Approvals', icon: CheckSquare, anyRoles: ['Admin', 'Manager'], badge: 'approvals', badgeTone: 'error' },
  { to: '/categories', label: 'Categories', icon: FolderTree, permission: 'product.view' },
  { to: '/purchase-orders', label: 'Purchase orders', icon: Truck, permission: 'supplier.view', badge: 'po' },
  { to: '/invoices/edit-requests', label: 'Edit requests', icon: FileEdit, permission: 'invoice.edit_approve', badge: 'editRequests' },
  { to: '/settings', label: 'Settings', icon: Settings, permission: 'settings.view' },
  { to: '/admin/error-logs', label: 'Error logs', icon: AlertCircle, permission: 'errors.view_all' },
];

function itemAllowed(item: NavItem, hasPermission: (p: string) => boolean, role?: string) {
  if (item.anyRoles && item.anyRoles.length) {
    if (!role || !item.anyRoles.includes(role)) return false;
  }
  if (item.anyPermissions && item.anyPermissions.length) {
    return item.anyPermissions.some((p) => hasPermission(p));
  }
  return !item.permission || hasPermission(item.permission);
}

function visibleItems(nav: NavItem[], hasPermission: (p: string) => boolean, role?: string) {
  const result: NavItem[] = [];
  for (let i = 0; i < nav.length; i++) {
    const item = nav[i];
    if (item.section) {
      const next: NavItem[] = [];
      for (let j = i + 1; j < nav.length && !nav[j].section; j++) {
        next.push(nav[j]);
      }
      const anyVisible = next.some((n) => itemAllowed(n, hasPermission, role));
      if (anyVisible) result.push(item);
    } else if (itemAllowed(item, hasPermission, role)) {
      result.push(item);
    }
  }
  return result;
}

export default function Sidebar() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const role = useAuthStore((s) => s.user?.role);
  const storeName = useAppSettingsStore(
    (s) => s.publicSettings?.store_name || s.settings?.store_name,
  );
  const openBugReport = useUiErrorStore((s) => s.openBugReport);
  const [collapsed, setCollapsed] = useState(false);
  const approvalCount = useNotificationStore((s) => s.approvalCount);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const pathname = usePathname();

  useEffect(() => {
    try {
      const saved = localStorage.getItem('mahali.sidebarCollapsed');
      if (saved === '1') setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('mahali.sidebarCollapsed', next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  const lowStockCount = useInventoryStore((s) => s.lowStockCount);
  const pendingReorderAlerts = useInventoryStore((s) => s.pendingReorderAlerts);
  const pendingAdjustments = useInventoryStore((s) => s.pendingAdjustmentsCount);
  const pendingPaymentCount = useSupplierStore((s) => s.pendingPaymentCount);
  const overdueCount = useSupplierStore((s) => s.overdueCount);
  const pendingEditRequests = useInvoiceStore((s) => s.pendingEditRequests);
  const returnsPending = useReturnStore((s) => s.pendingCount);
  const billsAttention = useBillStore((s) => s.attentionCount());
  void useCustomerStore;
  void useWarrantyStore;
  void useAttendanceStore;

  function badgeFor(key?: string) {
    if (key === 'inventory') {
      const total =
        (lowStockCount || 0) +
        (pendingReorderAlerts?.length || 0) +
        (pendingAdjustments || 0);
      return total > 0 ? total : null;
    }
    if (key === 'po') {
      const total = (overdueCount || 0) + (pendingPaymentCount || 0);
      return total > 0 ? total : null;
    }
    if (key === 'editRequests') {
      return pendingEditRequests > 0 ? pendingEditRequests : null;
    }
    if (key === 'returnsPending') {
      return returnsPending > 0 ? returnsPending : null;
    }
    if (key === 'billsAttention') {
      return billsAttention > 0 ? billsAttention : null;
    }
    if (key === 'approvals') {
      return approvalCount > 0 ? approvalCount : null;
    }
    return null;
  }

  return (
    <aside
      className={cn(
        'shrink-0 border-r border-border bg-surface flex flex-col transition-all',
        collapsed ? 'w-[72px]' : 'w-64',
      )}
    >
      <div className="flex items-center gap-2 px-4 py-5 border-b border-border">
        <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
          <Zap size={18} />
        </div>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-ink">{storeName || 'Mahali Light'}</p>
            <p className="text-xs text-ink-muted">Electrical · POS</p>
          </div>
        )}
        <button
          type="button"
          onClick={toggleCollapse}
          className={cn('ml-auto rounded-md p-1 text-ink-muted hover:bg-surface-2', collapsed && 'mx-auto')}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
        {visibleItems(NAV, hasPermission, role).map((item, idx) => {
          if (item.section) {
            if (collapsed) return null;
            return (
              <p
                key={`section-${idx}`}
                className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
              >
                {item.section}
              </p>
            );
          }
          const Icon = item.icon!;
          const badge = item.badge ? badgeFor(item.badge) : null;
          const isActive = item.to === '/dashboard'
            ? pathname === '/dashboard'
            : pathname === item.to || pathname.startsWith(item.to + '/');
          return (
            <Link
              key={item.to}
              href={item.to!}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition',
                isActive ? 'bg-accent-light text-accent' : 'text-ink hover:bg-surface-2',
                collapsed && 'justify-center px-2',
              )}
            >
              <Icon size={16} className="shrink-0" />
              {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
              {!collapsed && badge !== null && (
                <SidebarBadge count={badge} tone={item.badgeTone} />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-2 py-3 space-y-1">
        <button
          type="button"
          onClick={() => openBugReport()}
          title="Report a bug"
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-surface-2',
            collapsed && 'justify-center',
          )}
        >
          <Bug size={16} />
          {!collapsed && <span>Bug report</span>}
        </button>
        {!collapsed && (
          <div className="px-3">
            <AppVersion />
          </div>
        )}
        {!collapsed && unreadCount > 0 && (
          <p className="px-3 text-[11px] text-ink-muted">{unreadCount} unread notifications</p>
        )}
      </div>
    </aside>
  );
}
