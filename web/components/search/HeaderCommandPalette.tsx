'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Building2, Bug, FileSpreadsheet, Lock, LogOut, Monitor, Package, PackagePlus,
  Receipt, RotateCcw, Search, Shield, ShoppingCart, Truck, Unlock, UserPlus, UserRound, Users,
} from 'lucide-react';
import { CommandPalette } from '@/components/ui/command-palette';
import type { CommandItem } from '@/components/ui/command-palette';
import { useAuthStore } from '@/store/authStore';
import { useTreasuryStore } from '@/store/treasuryStore';
import { useUiErrorStore } from '@/store/uiErrorStore';
import { useQuickActionStore } from '@/store/quickActionStore';
import { useShortcutBindings } from '@/store/shortcutStore';
import { formatShortcut, usePlatform } from '@/components/ui/shortcut-recorder';
import { useSignOut } from '@/hooks/useSignOut';
import { globalSearch } from '@/services/searchService';
import { downloadExport } from '@/services/reportService';
import { addBreadcrumb } from '@/services/breadcrumbService';
import { toast } from '@/store/toastStore';
import { motionTokens } from '@/lib/motion-tokens';

/** How many commands show before anything is typed; the rest appear when searched. */
const SUGGESTED_COUNT = 4;

interface Command extends CommandItem {
  run: () => void;
}

const icon = (Icon: typeof Search) => <Icon strokeWidth={1.75} />;

// Records from the server search, and where each one opens.
const RECORD_TYPES: Record<string, { group: string; icon: ReactNode; href: (r: any) => string }> = {
  products: { group: 'Products', icon: icon(Package), href: (r) => `/products/${r.id}` },
  customers: { group: 'Customers', icon: icon(Users), href: (r) => `/customers/${r.id}` },
  invoices: { group: 'Invoices', icon: icon(Receipt), href: (r) => `/invoices/${r.id}` },
  suppliers: { group: 'Suppliers', icon: icon(Building2), href: (r) => `/suppliers/${r.id}` },
  employees: { group: 'Employees', icon: icon(UserRound), href: () => '/employees' },
  purchase_orders: { group: 'Purchase orders', icon: icon(Truck), href: (r) => `/purchase-orders/${r.id}` },
  warranties: { group: 'Warranties', icon: icon(Shield), href: (r) => `/warranties/${r.id}` },
  returns: { group: 'Returns', icon: icon(RotateCcw), href: (r) => `/returns/requests/${r.id}` },
};

const recordLabel = (r: any) =>
  r.name || r.invoice_number || r.request_number || r.warranty_number || r.po_number || r.sku || 'Untitled';

/**
 * The header's search field, now a command palette. Ctrl+K (or Ctrl+F) opens
 * it from anywhere in the dashboard. Empty, it suggests four actions; typing
 * searches every action plus products, customers, invoices and other records.
 */
export default function HeaderCommandPalette() {
  const router = useRouter();
  const reduced = useReducedMotion();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const drawerStatus = useTreasuryStore((s) => s.drawerStatus);
  const openBugReport = useUiErrorStore((s) => s.openBugReport);
  const signOut = useSignOut();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<{ q: string; data: Record<string, any[]> } | null>(null);
  const openCustomerForm = useQuickActionStore((s) => s.openCustomerForm);
  const keys = useShortcutBindings();
  const platform = usePlatform();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mounted = useMounted();

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setQuery('');
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);

  // Ctrl+K opens the palette from anywhere; Ctrl+F (the old search shortcut) does too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'k' && key !== 'f') return;
      // Settings has its own search on Ctrl+K while it's open.
      if (useQuickActionStore.getState().settingsOpen) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Record search, debounced like the old search bar.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setRecords(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await globalSearch(q);
        if (cancelled) return;
        setRecords({ q, data: data || {} });
        addBreadcrumb('search', { q });
      } catch {
        if (!cancelled) setRecords(null);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const download = useCallback((type: string, label: string) => {
    toast.info(`Preparing ${label}…`);
    downloadExport(type, 'excel')
      .then((res: any) => toast.success(`${label} downloaded (${res.filename}).`))
      .catch((err: any) => toast.error(err?.message || 'Export failed.'));
  }, []);

  // Listed in suggestion order: the first four the user may run are the suggestions.
  const commands = useMemo<Command[]>(() => {
    const drawerOpen = drawerStatus === 'open';
    const canExcel = hasPermission('report.export_excel');
    // Shows each user's own keys from the shortcut engine.
    const hint = (shortcut: string | null) => (shortcut ? formatShortcut(shortcut, platform).text : undefined);
    const list: Array<Command & { allowed: boolean }> = [
      {
        id: 'new-invoice', label: 'New invoice', description: 'Open the POS to start a sale', group: 'Sales',
        icon: icon(ShoppingCart), shortcut: hint(keys['new-pos']), keywords: ['pos', 'sale', 'sell', 'bill'],
        allowed: hasPermission('invoice.create'), run: () => router.push('/pos'),
      },
      {
        id: 'cashier-mode', label: 'Cashier mode', description: 'Full-screen cashier workspace', group: 'Sales',
        icon: icon(Monitor), shortcut: hint(keys['cashier-mode']), keywords: ['checkout', 'till', 'terminal'],
        allowed: hasPermission('invoice.create'), run: () => router.push('/cashier'),
      },
      {
        id: 'add-customer', label: 'Add new customer', group: 'Customers & products',
        icon: icon(UserPlus), shortcut: hint(keys['new-customer']), keywords: ['client', 'create customer'],
        allowed: hasPermission('customer.create'), run: () => openCustomerForm(),
      },
      {
        id: 'add-product', label: 'Add new product', group: 'Customers & products',
        icon: icon(PackagePlus), shortcut: hint(keys['new-product']), keywords: ['item', 'create product', 'sku'],
        allowed: hasPermission('product.create'), run: () => router.push('/products/new'),
      },
      drawerOpen
        ? {
            id: 'close-drawer', label: 'Close cash drawer', description: 'Count the cash and end the session', group: 'Cash drawer',
            icon: icon(Lock), keywords: ['cash', 'till', 'end of day', 'drawer'],
            allowed: hasPermission('cash.adjust'), run: () => router.push('/treasury?tab=cash&action=close'),
          }
        : {
            id: 'open-drawer', label: 'Open cash drawer', description: 'Start a cash session', group: 'Cash drawer',
            icon: icon(Unlock), keywords: ['cash', 'till', 'start of day', 'drawer'],
            allowed: hasPermission('cash.adjust'), run: () => router.push('/treasury?tab=cash&action=open'),
          },
      {
        id: 'report-inventory', label: 'Download product inventory', description: 'Excel', group: 'Reports',
        icon: icon(FileSpreadsheet), keywords: ['stock', 'export', 'xlsx', 'excel', 'report'],
        allowed: canExcel, run: () => download('custom_product_inventory', 'Product inventory'),
      },
      {
        id: 'report-costing', label: 'Download costing', description: 'Excel', group: 'Reports',
        icon: icon(FileSpreadsheet), keywords: ['cost', 'sales', 'profit', 'export', 'xlsx', 'excel', 'report'],
        allowed: canExcel, run: () => download('custom_costing_sales', 'Costing'),
      },
      {
        id: 'report-monthly', label: 'Download monthly summary', description: 'Excel', group: 'Reports',
        icon: icon(FileSpreadsheet), keywords: ['month', 'summary', 'export', 'xlsx', 'excel', 'report'],
        allowed: canExcel, run: () => download('custom_monthly_summary', 'Monthly summary'),
      },
      {
        id: 'report-bug', label: 'Report a bug', group: 'Account',
        icon: icon(Bug), shortcut: hint('mod+shift+b'), keywords: ['issue', 'problem', 'feedback', 'error'],
        allowed: true, run: () => openBugReport(),
      },
      {
        id: 'sign-out', label: 'Sign out', group: 'Account',
        icon: icon(LogOut), keywords: ['log out', 'logout', 'exit'],
        allowed: true, run: () => void signOut(),
      },
    ];
    return list.filter((c) => c.allowed).map(({ allowed: _allowed, ...c }) => c);
  }, [drawerStatus, hasPermission, router, download, openBugReport, signOut, keys, platform, openCustomerForm]);

  const recordItems = useMemo<Command[]>(() => {
    if (!records) return [];
    const matched = records.q === query.trim();
    return Object.entries(records.data).flatMap(([type, rows]) => {
      const meta = RECORD_TYPES[type];
      if (!meta || !rows?.length) return [];
      return rows.slice(0, 5).map((row) => ({
        id: `${type}-${row.id}`,
        label: recordLabel(row),
        description: row.sku && row.name ? row.sku : row.phone || undefined,
        group: meta.group,
        icon: meta.icon,
        alwaysShow: matched,
        run: () => router.push(meta.href(row)),
      }));
    });
  }, [records, query, router]);

  const items = useMemo<Command[]>(
    () =>
      query.trim()
        ? [...commands, ...recordItems]
        : commands.slice(0, SUGGESTED_COUNT).map((c) => ({ ...c, group: 'Suggested' })),
    [query, commands, recordItems],
  );

  function select(item: CommandItem) {
    const command = items.find((c) => c.id === item.id);
    // Navigation and new panels take focus themselves; don't pull it back to the header.
    close(false);
    command?.run();
  }

  const overlay = (
    <AnimatePresence>
      {open && (
        <motion.div
          key="command-palette"
          className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : motionTokens.duration.fast }}
        >
          <div className="absolute inset-0 bg-ink/30" aria-hidden="true" onMouseDown={() => close()} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="relative w-full max-w-[600px]"
            exit={reduced ? undefined : { scale: 0.98, y: 4 }}
            transition={{ duration: motionTokens.duration.instant }}
          >
            <CommandPalette
              items={items}
              autoFocus
              placeholder="Search actions, products, customers, invoices…"
              onQueryChange={setQuery}
              onSelect={select}
              onClose={() => close()}
              emptyTitle="No matches"
              emptyHint="Try another word, a product name, SKU or invoice number."
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="group flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-surface pl-3 pr-2 text-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Search size={16} aria-hidden="true" />
        <span className="flex-1 truncate text-left">Search or run a command…</span>
        <kbd className="hidden shrink-0 rounded-md border border-border bg-surface px-1.5 py-0.5 font-sans text-[11px] font-medium text-ink-muted sm:inline">
          Ctrl K
        </kbd>
      </button>
      {mounted && createPortal(overlay, document.body)}
    </>
  );
}

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
