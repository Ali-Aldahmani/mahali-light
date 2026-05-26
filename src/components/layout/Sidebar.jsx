import { NavLink } from 'react-router-dom';
import {
  Boxes,
  Building2,
  FileEdit,
  FolderTree,
  LayoutDashboard,
  Package,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Sliders,
  Truck,
  UsersRound,
  UserCog,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { useInventoryStore } from '../../store/inventoryStore.js';
import { useSupplierStore } from '../../store/supplierStore.js';
import { useCustomerStore } from '../../store/customerStore.js';
import { useInvoiceStore } from '../../store/invoiceStore.js';
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
  { section: 'Administration' },
  { to: '/users', label: 'Users', icon: UserCog, permission: 'user.edit' },
  { to: '/employees', label: 'Employees', icon: UsersRound, permission: 'employee.view' },
  { to: '/roles', label: 'Roles & Permissions', icon: ShieldCheck, permission: 'user.edit' },
];

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
      const anyVisible = next.some(
        (n) => !n.permission || hasPermission(n.permission),
      );
      if (anyVisible) result.push(item);
    } else if (!item.permission || hasPermission(item.permission)) {
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
