import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const STORAGE_KEY = 'mahali-light.demo.auth';

export const ALL_PERMISSIONS = [
  '*',
  'analytics.view',
  'analytics.view_dashboard',
  'analytics.view_peaks',
  'analytics.view_reorder',
  'analytics.view_seasonality',
  'analytics.export_forecast',
  'analytics.manage_reorder_settings',
  'dashboard.view',
  'user.view',
  'user.create',
  'user.edit',
  'user.change_role',
  'employee.view',
  'employee.create',
  'employee.edit',
  'product.view',
  'product.create',
  'product.edit',
  'product.view_cost',
  'stock.view',
  'stock.adjust',
  'stock.adjust_request',
  'stock.adjust_direct',
  'stock.adjust_approve',
  'stock.count',
  'stock.count_initiate',
  'stock.count_approve',
  'supplier.view',
  'supplier.create',
  'supplier.edit',
  'supplier.delete',
  'supplier.purchase_order.create',
  'supplier.purchase_order.pay',
  'customer.view',
  'customer.create',
  'customer.edit',
  'customer.delete',
  'customer.view_balance',
  'customer.collect_payment',
  'invoice.view',
  'invoice.create',
  'invoice.edit_approve',
  'invoice.edit_request',
  'invoice.cancel',
  'warranty.view',
  'warranty.create',
  'warranty.claim',
  'return.request',
  'return.approve',
  'cash.view',
  'cash.drawer',
  'bills.view',
  'finance.view_dashboard',
  'finance.view_journal',
  'report.financial',
  'report.sales',
  'report.inventory',
  'report.schedule',
  'attendance.view_own',
  'attendance.view_all',
  'attendance.approve_leave',
  'attendance.approve_correction',
  'settings.view',
  'settings.edit',
  'backup.view',
  'bug.view_all',
  'errors.view_all',
];

const DEFAULT_DEMO_USER = {
  id: 1,
  username: 'admin',
  full_name: 'Rashid Al Nuaimi',
  email: 'rashid@almanarelectric.ae',
  phone: '+971 50 123 4567',
  role: 'Admin',
  permissions: ALL_PERMISSIONS,
};

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: DEFAULT_DEMO_USER,
      token: 'demo-token-12345',
      permissions: ALL_PERMISSIONS,

      isAuthenticated: () => Boolean(get().token && get().user),

      hasPermission: (key) => {
        if (!key) return true;
        const perms = get().permissions || [];
        if (perms.includes('*')) return true;
        return perms.includes(key);
      },

      hasAnyPermission: (keys = []) => {
        const perms = get().permissions || [];
        if (perms.includes('*')) return true;
        const owned = new Set(perms);
        return keys.some((k) => owned.has(k));
      },

      setSession: ({ token, user }) => {
        const perms = user?.permissions?.length ? user.permissions : ALL_PERMISSIONS;
        set({
          token: token || 'demo-token-12345',
          user: user || DEFAULT_DEMO_USER,
          permissions: perms,
        });
      },

      setUser: (user) => {
        const perms = user?.permissions?.length ? user.permissions : ALL_PERMISSIONS;
        set({ user, permissions: perms });
      },

      logoutLocal: () => set({ user: null, token: null, permissions: [] }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        permissions: state.permissions,
      }),
    },
  ),
);
