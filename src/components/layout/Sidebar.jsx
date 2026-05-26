import { NavLink } from 'react-router-dom';
import {
  Boxes,
  Building2,
  FileEdit,
  FolderTree,
  LayoutDashboard,
  Package,
  Printer,
  Receipt,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Sliders,
  Search as SearchIcon,
  Truck,
  UsersRound,
  UserCog,
  Users,
  Wallet,
  Banknote,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  Zap,
  LineChart,
  Scale,
  BookOpen,
  CalendarRange,
  BarChart3,
  CalendarCheck2,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { useInventoryStore } from '../../store/inventoryStore.js';
import { useSupplierStore } from '../../store/supplierStore.js';
import { useCustomerStore } from '../../store/customerStore.js';
import { useInvoiceStore } from '../../store/invoiceStore.js';
import { useWarrantyStore } from '../../store/warrantyStore.js';
import { useReturnStore } from '../../store/returnStore.js';
import { useAttendanceStore } from '../../store/attendanceStore.js';
import { useBillStore } from '../../store/billStore.js';
import { cn } from '../../utils/cn.js';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: null },
  { section: 'Catalog' },
  { to: '/products', label: 'Products', icon: Package, permission: 'product.view' },
  { to: '/categories', label: 'Categories', icon: FolderTree, permission: 'product.view' },
  { to: '/attributes', label: 'Attributes', icon: Sliders, permission: 'product.view' },
  { section: 'Operations' },
  {
    to: '/inventory',
    label: 'Inventory',
    icon: Boxes,
    permission: 'stock.view',
    badge: 'inventory',
  },
  { section: 'Procurement' },
  {
    to: '/suppliers',
    label: 'Suppliers',
    icon: Building2,
    permission: 'supplier.view',
  },
  {
    to: '/purchase-orders',
    label: 'Purchase orders',
    icon: Truck,
    permission: 'supplier.view',
    badge: 'po',
  },
  { section: 'Sales' },
  {
    to: '/pos',
    label: 'POS',
    icon: ShoppingCart,
    permission: 'invoice.create',
  },
  {
    to: '/invoices',
    label: 'Invoices',
    icon: Receipt,
    permission: 'invoice.view',
  },
  {
    to: '/invoices/edit-requests',
    label: 'Edit requests',
    icon: FileEdit,
    permission: 'invoice.edit_approve',
    badge: 'editRequests',
  },
  {
    to: '/customers',
    label: 'Customers',
    icon: Users,
    permission: 'customer.view',
    badge: 'customers',
  },
  {
    to: '/customers/outstanding',
    label: 'Receivables',
    icon: Wallet,
    permission: 'customer.view_balance',
    badge: 'receivables',
  },
  { section: 'Warranties' },
  {
    to: '/warranties/lookup',
    label: 'Warranty lookup',
    icon: SearchIcon,
    permission: 'warranty.view',
  },
  {
    to: '/warranties',
    label: 'Warranties',
    icon: Shield,
    permission: 'warranty.view',
    badge: 'warrantiesExpiring',
  },
  {
    to: '/warranty-claims',
    label: 'Claims',
    icon: ShieldAlert,
    permission: 'warranty.view',
    badge: 'warrantyClaims',
  },
  { section: 'Returns' },
  {
    to: '/returns',
    label: 'Returns',
    icon: RotateCcw,
    permission: 'return.request',
    badge: 'returnsPending',
  },
  { section: 'Treasury' },
  {
    to: '/treasury',
    label: 'Treasury',
    icon: Banknote,
    permission: 'cash.view',
  },
  { section: 'Attendance' },
  {
    to: '/attendance',
    label: 'Attendance',
    icon: CalendarClock,
    permission: 'attendance.view_own',
    badge: 'attendancePending',
  },
  {
    to: '/attendance/leave-balances',
    label: 'Leave balances',
    icon: CalendarDays,
    permission: 'attendance.view_all',
  },
  {
    to: '/attendance/holidays',
    label: 'Holidays',
    icon: CalendarOff,
    permission: 'attendance.view_own',
  },
  { section: 'Expenses' },
  {
    to: '/expenses',
    label: 'Bills & expenses',
    icon: Receipt,
    permission: 'bills.view',
    badge: 'billsAttention',
  },
  { section: 'Finance' },
  { to: '/finance',          label: 'Finance',           icon: LineChart,     permission: 'finance.view_dashboard' },
  { to: '/finance/journal',  label: 'Journal entries',   icon: BookOpen,      permission: 'finance.view_journal'    },
  { to: '/finance/accounts', label: 'Chart of accounts', icon: Scale,         permission: 'finance.view_journal'    },
  { to: '/finance/periods',  label: 'Periods',           icon: CalendarRange, permission: 'finance.view_journal'    },
  { section: 'Reports' },
  {
    to: '/reports',
    label: 'All reports',
    icon: BarChart3,
    anyPermissions: [
      'report.financial',
      'report.sales',
      'report.inventory',
      'report.suppliers',
      'report.customers',
      'report.employees',
      'report.attendance',
      'report.warranty',
      'report.returns',
      'report.bills',
      'report.employee_performance_own',
      'report.employee_performance_all',
    ],
  },
  {
    to: '/reports/net-profit',
    label: 'Net profit',
    icon: LineChart,
    permission: 'report.financial',
  },
  {
    to: '/reports/scheduled',
    label: 'Scheduled reports',
    icon: CalendarCheck2,
    permission: 'report.schedule',
  },
  { section: 'Administration' },
  { to: '/users', label: 'Users', icon: UserCog, permission: 'user.edit' },
  { to: '/employees', label: 'Employees', icon: UsersRound, permission: 'employee.view' },
  { to: '/roles', label: 'Roles & Permissions', icon: ShieldCheck, permission: 'user.edit' },
  {
    to: '/settings/printers',
    label: 'Printers & branding',
    icon: Printer,
    permission: 'settings.view',
  },
];

function itemAllowed(item, hasPermission) {
  if (item.anyPermissions && item.anyPermissions.length) {
    return item.anyPermissions.some((p) => hasPermission(p));
  }
  return !item.permission || hasPermission(item.permission);
}

function visibleItems(nav, hasPermission) {
  // Hide section headers that have no permitted items beneath them.
  const result = [];
  for (let i = 0; i < nav.length; i++) {
    const item = nav[i];
    if (item.section) {
      const next = [];
      for (let j = i + 1; j < nav.length && !nav[j].section; j++) {
        next.push(nav[j]);
      }
      const anyVisible = next.some((n) => itemAllowed(n, hasPermission));
      if (anyVisible) result.push(item);
    } else if (itemAllowed(item, hasPermission)) {
      result.push(item);
    }
  }
  return result;
}

export default function Sidebar() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const lowStockCount = useInventoryStore((s) => s.lowStockCount);
  const pendingReorderAlerts = useInventoryStore((s) => s.pendingReorderAlerts);
  const pendingAdjustments = useInventoryStore((s) => s.pendingAdjustmentsCount);
  const pendingPaymentCount = useSupplierStore((s) => s.pendingPaymentCount);
  const overdueCount = useSupplierStore((s) => s.overdueCount);
  const customersWithBalance = useCustomerStore((s) => s.customersWithBalance);
  const pendingEditRequests = useInvoiceStore((s) => s.pendingEditRequests);
  const expiringSoonCount = useWarrantyStore((s) => s.expiringSoonCount);
  const openClaimsCount = useWarrantyStore((s) => s.openClaimsCount);
  const returnsPending = useReturnStore((s) => s.pendingCount);
  const pendingCorrections = useAttendanceStore((s) => s.pendingCorrections);
  const pendingLeaves = useAttendanceStore((s) => s.pendingLeaves);
  const billsAttention = useBillStore((s) => s.attentionCount());

  function badgeFor(key) {
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
    if (key === 'customers' || key === 'receivables') {
      return customersWithBalance > 0 ? customersWithBalance : null;
    }
    if (key === 'editRequests') {
      return pendingEditRequests > 0 ? pendingEditRequests : null;
    }
    if (key === 'warrantiesExpiring') {
      return expiringSoonCount > 0 ? expiringSoonCount : null;
    }
    if (key === 'warrantyClaims') {
      return openClaimsCount > 0 ? openClaimsCount : null;
    }
    if (key === 'returnsPending') {
      return returnsPending > 0 ? returnsPending : null;
    }
    if (key === 'attendancePending') {
      const total = (pendingCorrections?.length || 0) + (pendingLeaves?.length || 0);
      return total > 0 ? total : null;
    }
    if (key === 'billsAttention') {
      return billsAttention > 0 ? billsAttention : null;
    }
    return null;
  }

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-border">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white">
          <Zap size={18} />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-ink">Mahali Light</p>
          <p className="text-xs text-ink-muted">Electrical · POS</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {visibleItems(NAV, hasPermission).map((item, idx) => {
          if (item.section) {
            return (
              <p
                key={`section-${idx}`}
                className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
              >
                {item.section}
              </p>
            );
          }
          const Icon = item.icon;
          const badge = item.badge ? badgeFor(item.badge) : null;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition',
                  isActive
                    ? 'bg-accent-light text-accent'
                    : 'text-ink hover:bg-surface-2',
                )
              }
            >
              <Icon size={16} />
              <span className="flex-1">{item.label}</span>
              {badge !== null && (
                <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 text-[11px] font-medium rounded-full bg-accent text-white">
                  {badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="px-5 py-3 border-t border-border text-[11px] text-ink-muted">
        v0.3.0 · {new Date().getFullYear()}
      </div>
    </aside>
  );
}
