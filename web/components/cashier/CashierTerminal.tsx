'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileSearch,
  PackagePlus,
  PackageSearch,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  Tag,
  UserPlus,
  Users,
} from 'lucide-react';
import { CashierBottomBar, CashierTopBar } from './CashierBars';
import CashierProductGrid from './CashierProductGrid';
import CashierCart from './CashierCart';
import CashierPaymentDialog from './CashierPaymentDialog';
import CashierSuccessDialog, { type CompletedSale } from './CashierSuccessDialog';
import CashierCustomerDialog from './CashierCustomerDialog';
import CashierQuickActionsDialog, { type QuickAction } from './CashierQuickActionsDialog';
import CashierExitDialog from './CashierExitDialog';
import { CashierHeldSalesDialog, CashierInvoicesDialog, CashierStockDialog } from './CashierLookupDialogs';
import QuickAddProductModal from '@/components/pos/QuickAddProductModal';
import AddCustomItemModal from '@/components/pos/AddCustomItemModal';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useCashierKeyboard } from '@/hooks/useCashierKeyboard';
import { clearSaleBackup, useSaleBackup } from '@/hooks/useSaleBackup';
import { computeTotals, usePosStore } from '@/store/posStore';
import { useAuthStore } from '@/store/authStore';
import { useAppSettingsStore } from '@/store/appSettingsStore';
import { useOfflineStore } from '@/store/offlineStore';
import { useInvoiceStore } from '@/store/invoiceStore';
import { onPrintRequest, onStockUpdate } from '@/store/socketStore';
import { toast } from '@/store/toastStore';
import { searchProducts } from '@/services/productService';
import { listCategoriesFlat } from '@/services/categoryService';
import { getInvoice } from '@/services/invoiceService';
import { printReceipt } from '@/services/printService';
import { checkoutErrorMessage, prepareCheckout, saveDraft, submitSale } from '@/lib/pos/checkout';
import { cartViolations } from '@/lib/cashier/pricing';
import { createScanQueue, findExactCodeMatch, normalizeCode } from '@/lib/cashier/barcode';
import type { CashierAction } from '@/lib/cashier/shortcuts';
import { formatCurrency } from '@/lib/utils/format';

type DialogName =
  | 'pay'
  | 'customer'
  | 'customerCreate'
  | 'quick'
  | 'held'
  | 'invoices'
  | 'stock'
  | 'product'
  | 'custom'
  | 'exit'
  | null;

const REMOVE_CONFIRM_MS = 3000;

function toCartLine(variant: any, item: any) {
  const percent = Number(item.discountPercent || 0);
  return {
    variantId: item.variantId,
    productId: item.productId,
    productName: variant?.productName || item.productName,
    sku: item.sku,
    unitLabel: variant?.unitLabel || item.unitLabel || 'pcs',
    soldBy: variant?.soldBy || 'piece',
    attributes: variant?.attributes || [],
    stockQty: Number(variant?.stockQty ?? 0),
    imagePath: variant?.imagePath || null,
    // Catalog price comes from the server search; the server re-prices anyway.
    unitPrice: Number(variant?.sellingPrice ?? item.unitPrice),
    quantity: Number(item.quantity),
    discountPercent: percent,
    discountAmount: percent > 0 ? 0 : Number(item.discountAmount || 0),
    pricingRestriction: variant?.pricingRestriction || null,
    serialNumber: item.serialNumber || '',
    serialValid: true,
    serialError: null,
    requiresSerial: !!variant?.requiresSerial,
    defaultWarrantyMonths: Number(variant?.defaultWarrantyMonths || 0),
  };
}

export default function CashierTerminal() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const perms = useMemo(() => {
    const has = (p: string) => (permissions || []).includes(p);
    return {
      discount: has('invoice.override_price'),
      customerView: has('customer.view'),
      customerCreate: has('customer.create'),
      viewBalance: has('customer.view_balance'),
      productCreate: has('product.create'),
      productView: has('product.view'),
      customItem: has('invoice.custom_item'),
      invoiceView: has('invoice.view'),
      returns: has('return.request'),
    };
  }, [permissions]);

  const userId = (user?.id as string | undefined) ?? null;
  useSaleBackup(userId);

  // ---- Sale state (shared posStore) --------------------------------------
  const cart = usePosStore((s) => s.cart);
  const selectedCustomer = usePosStore((s) => s.selectedCustomer);
  const payments = usePosStore((s) => s.payments);
  const invoiceDiscount = usePosStore((s) => s.invoiceDiscount);
  const taxRate = usePosStore((s) => s.taxRate);
  const pcIdentifier = usePosStore((s) => s.pcIdentifier);
  const draftInvoiceId = usePosStore((s) => s.draftInvoiceId);
  const draftInvoiceNumber = usePosStore((s) => s.draftInvoiceNumber);
  const totals = useMemo(
    () => computeTotals({ cart, invoiceDiscount, taxRate, payments }),
    [cart, invoiceDiscount, taxRate, payments],
  );
  const violations = useMemo(() => cartViolations(totals.items, totals.invoiceDiscount), [totals]);

  const publicSettings = useAppSettingsStore((s) => s.publicSettings);
  const fetchPublicSettings = useAppSettingsStore((s) => s.fetchPublic);
  const allowNegativeStock = !!publicSettings?.pos_allow_negative_stock;
  const storeName = publicSettings?.store_name || 'POS';
  const online = !useOfflineStore((s) => s.isOffline);
  const refreshInvoiceSummary = useInvoiceStore((s) => s.refreshSummary);

  useEffect(() => {
    fetchPublicSettings?.().catch(() => {});
  }, [fetchPublicSettings]);
  useEffect(() => {
    if (!publicSettings) return;
    const rate = publicSettings.vat_enabled ? Number(publicSettings.vat_rate ?? 5) : 0;
    usePosStore.getState().setTaxRate(Number.isFinite(rate) ? rate : 0);
  }, [publicSettings]);

  // ---- UI state ----------------------------------------------------------
  const [dialog, setDialog] = useState<DialogName>(null);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | number | null>(null);
  const [lastScan, setLastScan] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [completed, setCompleted] = useState<CompletedSale | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useCallback((select = false) => {
    const el = searchRef.current;
    if (!el) return;
    el.focus();
    if (select) el.select();
  }, []);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setTimeout(() => focusSearch(), 0);
  }, [focusSearch]);

  // ---- Products ----------------------------------------------------------
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);
  const [products, setProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | number | null>(null);
  const fetchSeq = useRef(0);
  const productsRef = useRef<any[]>([]);
  productsRef.current = products;
  const codeCache = useRef(new Map<string, any>());

  useEffect(() => {
    listCategoriesFlat()
      .then((rows: any) => setCategories(rows || []))
      .catch(() => setCategories([]));
  }, []);

  const fetchProducts = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoadingProducts(true);
    try {
      const rows = await searchProducts(debouncedQuery.trim(), 60, {
        categoryId: activeCategoryId || undefined,
      });
      if (seq === fetchSeq.current) setProducts(rows || []);
    } catch (_e) {
      // Keep the last good grid on a network error; the cart is untouched.
    } finally {
      if (seq === fetchSeq.current) setLoadingProducts(false);
    }
  }, [debouncedQuery, activeCategoryId]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const fetchProductsRef = useRef(fetchProducts);
  fetchProductsRef.current = fetchProducts;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onStockUpdate(() => {
      codeCache.current.clear();
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        fetchProductsRef.current();
      }, 1000);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    return onPrintRequest((payload: any) => {
      if (payload.kind !== 'receipt') return;
      if (payload.pcIdentifier && pcIdentifier && payload.pcIdentifier !== pcIdentifier) return;
      printReceipt(payload.invoiceId, { silent: true }).catch(() => {});
    });
  }, [pcIdentifier]);

  // ---- Fullscreen (optional) ---------------------------------------------
  useEffect(() => {
    setFullscreenSupported(typeof document !== 'undefined' && !!document.documentElement.requestFullscreen);
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => toast.info('Full screen is not available here.'));
  }, []);

  // ---- Cart operations ---------------------------------------------------
  const addVariant = useCallback(
    (variant: any) => {
      const state = usePosStore.getState();
      const existing = state.cart.find((i) => i.variantId === variant.variantId);
      const nextQty = (existing ? Number(existing.quantity) : 0) + 1;
      const stock = Number(variant.stockQty ?? existing?.stockQty ?? 0);
      if (!allowNegativeStock && nextQty > stock) {
        const text =
          stock <= 0
            ? `${variant.productName} is out of stock.`
            : `Only ${stock} ${variant.unitLabel || 'pcs'} of ${variant.productName} in stock.`;
        setLastScan({ tone: 'error', text });
        toast.error(text);
        return false;
      }
      state.addToCart(variant, 1);
      setSelectedId(variant.variantId);
      setPendingRemoveId(null);
      setUnknownCode(null);
      setLastScan({ tone: 'ok', text: `Added ${variant.productName} · qty ${nextQty}` });
      return true;
    },
    [allowNegativeStock],
  );

  const changeQty = useCallback(
    (id: string | number, qty: number) => {
      const state = usePosStore.getState();
      const line = state.cart.find((i) => i.variantId === id);
      if (!line || !(qty > 0)) return;
      const stock = Number(line.stockQty);
      if (!allowNegativeStock && !line.isCustom && Number.isFinite(stock) && qty > stock) {
        toast.error(`Only ${stock} ${line.unitLabel || 'pcs'} of ${line.productName} in stock.`);
        return;
      }
      state.updateQty(id, qty);
    },
    [allowNegativeStock],
  );

  // Two-step removal: first tap/Delete arms, second confirms within 3s.
  useEffect(() => {
    if (pendingRemoveId == null) return;
    const t = setTimeout(() => setPendingRemoveId(null), REMOVE_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [pendingRemoveId]);

  const requestRemove = useCallback(
    (id: string | number | null) => {
      if (id == null) return;
      if (pendingRemoveId === id) {
        const state = usePosStore.getState();
        const idx = state.cart.findIndex((i) => i.variantId === id);
        const line = state.cart[idx];
        state.removeFromCart(id);
        setPendingRemoveId(null);
        const rest = state.cart.filter((i) => i.variantId !== id);
        setSelectedId(rest.length ? rest[Math.min(idx, rest.length - 1)].variantId : null);
        if (line) setLastScan({ tone: 'ok', text: `Removed ${line.productName}` });
        return;
      }
      setSelectedId(id);
      setPendingRemoveId(id);
    },
    [pendingRemoveId],
  );

  // ---- Barcode / search resolution ---------------------------------------
  const resolveCode = useCallback(
    async (raw: string) => {
      const code = normalizeCode(raw);
      if (!code) return;
      const key = code.toLowerCase();
      let match = codeCache.current.get(key) || findExactCodeMatch(productsRef.current, code);
      if (!match) {
        setResolving(true);
        try {
          const rows = await searchProducts(code, 10);
          match = findExactCodeMatch(rows, code);
        } catch (_e) {
          setLastScan({ tone: 'error', text: `Could not look up ${code} — check the connection.` });
          return;
        } finally {
          setResolving(false);
        }
      }
      if (!match) {
        setUnknownCode(code);
        setLastScan({ tone: 'error', text: `Unknown barcode: ${code}` });
        toast.warning(`No product with barcode or SKU “${code}”.`);
        return;
      }
      codeCache.current.set(key, match);
      addVariant(match);
    },
    [addVariant],
  );

  const resolveRef = useRef(resolveCode);
  resolveRef.current = resolveCode;
  const enqueueScan = useMemo(() => createScanQueue((code: string) => resolveRef.current(code)), []);

  const setSearchText = useCallback((value: string) => {
    if (searchRef.current) searchRef.current.value = value;
    setQuery(value);
  }, []);

  const onSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const code = e.currentTarget.value;
        if (!normalizeCode(code)) return;
        // Clear immediately so the next rapid scan starts from an empty box.
        setSearchText('');
        enqueueScan(code);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (e.currentTarget.value) setSearchText('');
        else e.currentTarget.blur();
      }
    },
    [enqueueScan, setSearchText],
  );

  // ---- Payment -----------------------------------------------------------
  const missingSerial = totals.items.find(
    (it: any) => it.requiresSerial && (!it.serialNumber || !it.serialValid),
  );
  const firstViolation = violations.size ? [...violations.entries()][0] : null;
  const payBlockedReason = firstViolation
    ? `${totals.items.find((i: any) => i.variantId === firstViolation[0])?.productName}: ${firstViolation[1]
        .map((v) => v.message)
        .join(' ')}`
    : missingSerial
      ? missingSerial.serialError || `Enter a serial number for ${missingSerial.productName}.`
      : null;

  const openPay = useCallback(() => {
    const state = usePosStore.getState();
    if (!state.cart.length) return;
    if (payBlockedReason) {
      toast.error(payBlockedReason);
      return;
    }
    if (!state.payments.length) state.addPayment('cash', computeTotals(state).total);
    setPayError(null);
    setDialog('pay');
  }, [payBlockedReason]);

  const confirmPay = useCallback(async () => {
    const state = usePosStore.getState();
    const t = computeTotals(state);
    const prep = prepareCheckout({ totals: t, cart: state.cart, payments: state.payments, customer: state.selectedCustomer });
    if (prep.ok === false) {
      setPayError(prep.message);
      return;
    }
    setSubmitting(true);
    setPayError(null);
    try {
      const { invoiceId, confirmed } = await submitSale({
        draft: {
          items: t.items,
          customerId: state.selectedCustomer?.id || null,
          invoiceDiscount: state.invoiceDiscount,
          notes: state.notes || null,
          pcIdentifier: state.pcIdentifier,
        },
        allocations: prep.allocations,
        draftInvoiceId: state.draftInvoiceId,
        onDraftSaved: (id, number) => usePosStore.getState().setDraftInvoice(id, number),
      });
      const tendered = state.payments.filter((p) => p.method === 'cash').reduce((s, p) => s + Number(p.amount || 0), 0);
      const retained = prep.allocations.filter((p) => p.method === 'cash').reduce((s, p) => s + Number(p.amount || 0), 0);
      setCompleted({
        invoiceId,
        invoiceNumber: confirmed.invoice.invoiceNumber,
        total: confirmed.invoice.total,
        amountPaid: confirmed.invoice.amountPaid,
        balanceDue: confirmed.invoice.balanceDue,
        change: Math.max(0, Math.round((tendered - retained) * 100) / 100),
        customerName: state.selectedCustomer?.id ? state.selectedCustomer.name : null,
      });
      setDialog(null);
      usePosStore.getState().clearCart();
      clearSaleBackup();
      setSelectedId(null);
      setLastScan(null);
      codeCache.current.clear();
      refreshInvoiceSummary?.();
      fetchProductsRef.current();
    } catch (err: any) {
      setPayError(checkoutErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [refreshInvoiceSummary]);

  // ---- Hold / resume (server drafts) -------------------------------------
  const holdSale = useCallback(async (): Promise<boolean> => {
    const state = usePosStore.getState();
    if (!state.cart.length) {
      toast.info('Nothing to hold — the cart is empty.');
      return false;
    }
    setHolding(true);
    try {
      const t = computeTotals(state);
      const saved = await saveDraft(
        {
          items: t.items,
          customerId: state.selectedCustomer?.id || null,
          invoiceDiscount: state.invoiceDiscount,
          notes: state.notes || null,
          pcIdentifier: state.pcIdentifier,
        },
        state.draftInvoiceId,
      );
      usePosStore.getState().clearCart();
      clearSaleBackup();
      setSelectedId(null);
      setLastScan({ tone: 'ok', text: `Sale held${saved.invoiceNumber ? ` as ${saved.invoiceNumber}` : ''}.` });
      toast.success(`Sale held${saved.invoiceNumber ? ` as ${saved.invoiceNumber}` : ''}.`);
      return true;
    } catch (err: any) {
      toast.error(err?.message ? `Could not hold sale: ${err.message}` : 'Could not hold sale.');
      return false;
    } finally {
      setHolding(false);
    }
  }, []);

  const resumeSale = useCallback(
    async (invoiceId: string) => {
      const current = usePosStore.getState();
      if (current.cart.length && current.draftInvoiceId !== invoiceId) {
        // Park the on-screen sale first so nothing is lost.
        const held = await holdSale();
        if (!held) return;
      }
      setResumingId(invoiceId);
      try {
        const detail: any = await getInvoice(invoiceId);
        const inv = detail.invoice;
        if (inv.status !== 'draft') {
          toast.error('This sale is no longer on hold.');
          return;
        }
        if ((detail.payments || []).length) {
          toast.error('This draft already has payments recorded — finish it from the Invoices page.');
          return;
        }
        const items: any[] = detail.items || [];
        const catalog = await Promise.all(
          items.map((it) =>
            it.isCustom || !it.sku
              ? Promise.resolve([])
              : searchProducts(it.sku, 10).catch(() => []),
          ),
        );
        const lines = items.map((it, i) => {
          if (it.isCustom) {
            return {
              variantId: `custom-${it.id}`,
              productId: null,
              productName: it.productName,
              sku: null,
              unitLabel: it.unitLabel || 'pcs',
              soldBy: 'piece',
              attributes: [],
              stockQty: Infinity,
              imagePath: null,
              unitPrice: Number(it.unitPrice),
              quantity: Number(it.quantity),
              discountAmount: Number(it.discountAmount || 0),
              discountPercent: 0,
              serialNumber: '',
              serialValid: true,
              serialError: null,
              requiresSerial: false,
              defaultWarrantyMonths: 0,
              isCustom: true,
              thirdPartyName: it.thirdPartyName || null,
              costPrice: Number(it.costPriceAtTime || 0),
            };
          }
          const variant = (catalog[i] as any[]).find((v) => v.variantId === it.variantId) || null;
          return toCartLine(variant, it);
        });
        usePosStore.getState().loadSale({
          cart: lines,
          selectedCustomer: inv.customerId
            ? { id: inv.customerId, name: inv.customerName, phone: inv.customerPhone }
            : null,
          invoiceDiscount: inv.invoiceDiscount,
          notes: inv.notes || '',
          draftInvoiceId: inv.id,
          draftInvoiceNumber: inv.invoiceNumber,
        });
        setSelectedId(lines[0]?.variantId ?? null);
        setLastScan({ tone: 'ok', text: `Resumed ${inv.invoiceNumber}` });
        closeDialog();
      } catch (err: any) {
        toast.error(err?.message || 'Could not resume the sale.');
      } finally {
        setResumingId(null);
      }
    },
    [holdSale, closeDialog],
  );

  // ---- Exit --------------------------------------------------------------
  const leave = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    router.push('/pos');
  }, [router]);

  const requestExit = useCallback(() => {
    if (usePosStore.getState().cart.length) setDialog('exit');
    else leave();
  }, [leave]);

  // ---- Keyboard ----------------------------------------------------------
  const onAction = useCallback(
    (action: CashierAction) => {
      const lines = usePosStore.getState().cart;
      const idx = lines.findIndex((l) => l.variantId === selectedId);
      switch (action) {
        case 'focusSearch':
          focusSearch(true);
          break;
        case 'pay':
          openPay();
          break;
        case 'customer':
          if (perms.customerView || perms.customerCreate) setDialog('customer');
          break;
        case 'hold':
          holdSale();
          break;
        case 'resume':
          if (perms.invoiceView) setDialog('held');
          break;
        case 'quickActions':
          setDialog('quick');
          break;
        case 'qtyUp':
        case 'qtyDown': {
          const line = lines[idx];
          if (!line) break;
          const step = line.soldBy && line.soldBy !== 'piece' ? 0.5 : 1;
          const next = Number(line.quantity) + (action === 'qtyUp' ? step : -step);
          if (next > 0) changeQty(line.variantId, next);
          break;
        }
        case 'removeSelected':
          requestRemove(selectedId);
          break;
        case 'selectPrev':
        case 'selectNext': {
          if (!lines.length) break;
          const nextIdx =
            idx < 0
              ? action === 'selectNext'
                ? 0
                : lines.length - 1
              : Math.max(0, Math.min(lines.length - 1, idx + (action === 'selectNext' ? 1 : -1)));
          setSelectedId(lines[nextIdx].variantId);
          setPendingRemoveId(null);
          break;
        }
        case 'escape':
          if (pendingRemoveId != null) setPendingRemoveId(null);
          else if (unknownCode) setUnknownCode(null);
          else setSelectedId(null);
          break;
        default:
          break;
      }
    },
    [selectedId, pendingRemoveId, unknownCode, perms, focusSearch, openPay, holdSale, changeQty, requestRemove],
  );

  const onType = useCallback(
    (char: string) => {
      setSearchText(char);
      focusSearch();
    },
    [setSearchText, focusSearch],
  );

  useCashierKeyboard({ enabled: dialog === null && !completed, onAction, onType });

  // ---- Quick actions -----------------------------------------------------
  const quickActions: QuickAction[] = useMemo(() => {
    const list: QuickAction[] = [];
    if (perms.customerCreate) {
      list.push({ id: 'new-customer', label: 'New customer', description: 'Phone, name, email', Icon: UserPlus, onSelect: () => setDialog('customerCreate') });
    }
    if (perms.customerView) {
      list.push({ id: 'find-customer', label: 'Find customer', Icon: Users, hint: 'F6', onSelect: () => setDialog('customer') });
    }
    if (perms.productCreate) {
      list.push({ id: 'new-product', label: 'New product', description: 'Save & add to cart', Icon: PackagePlus, onSelect: () => setDialog('product') });
    }
    if (perms.customItem) {
      list.push({ id: 'custom-item', label: 'Custom item', description: 'Service / third-party line', Icon: Tag, onSelect: () => setDialog('custom') });
    }
    if (perms.productView) {
      list.push({ id: 'stock', label: 'Stock check', description: 'Read-only', Icon: PackageSearch, onSelect: () => setDialog('stock') });
    }
    list.push({ id: 'hold', label: 'Hold sale', Icon: PauseCircle, hint: 'F7', disabled: !cart.length, onSelect: () => holdSale() });
    if (perms.invoiceView) {
      list.push({ id: 'held', label: 'Held sales', Icon: PlayCircle, hint: 'F8', onSelect: () => setDialog('held') });
      list.push({ id: 'invoices', label: 'Find invoice', description: 'Reprint receipt', Icon: FileSearch, onSelect: () => setDialog('invoices') });
    }
    if (perms.returns) {
      list.push({ id: 'return', label: 'Return / refund', description: 'Opens the return form', Icon: RotateCcw, onSelect: () => router.push('/returns/new') });
    }
    return list;
  }, [perms, cart.length, holdSale, router]);

  const lines = totals.items;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-ink">
      <CashierTopBar
        ref={searchRef}
        storeName={storeName}
        userName={user?.username || ''}
        query={query}
        resolving={resolving}
        isFullscreen={isFullscreen}
        fullscreenSupported={fullscreenSupported}
        canCustomer={perms.customerView || perms.customerCreate}
        onQueryChange={setQuery}
        onSearchKeyDown={onSearchKeyDown}
        onCustomer={() => setDialog('customer')}
        onQuickActions={() => setDialog('quick')}
        onToggleFullscreen={toggleFullscreen}
      />

      {unknownCode && (
        <div role="alert" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-error/30 bg-error-light px-4 py-2 text-sm">
          <span className="font-medium text-error">No product found for “{unknownCode}”.</span>
          {perms.productCreate && (
            <button
              type="button"
              onClick={() => setDialog('product')}
              className="h-11 rounded-input bg-accent px-4 font-medium text-white hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Create product with this barcode
            </button>
          )}
          <button
            type="button"
            onClick={() => setUnknownCode(null)}
            className="h-11 rounded-input px-3 text-ink-muted hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <CashierProductGrid
          categories={categories}
          activeCategoryId={activeCategoryId}
          onCategoryChange={setActiveCategoryId}
          products={products}
          loading={loadingProducts}
          query={debouncedQuery.trim()}
          allowNegativeStock={allowNegativeStock}
          onAdd={addVariant}
        />
        <CashierCart
          lines={lines}
          totals={totals}
          customer={selectedCustomer}
          draftInvoiceNumber={draftInvoiceNumber}
          selectedId={selectedId}
          pendingRemoveId={pendingRemoveId}
          violations={violations}
          canDiscount={perms.discount}
          invoiceDiscount={invoiceDiscount}
          lastScan={lastScan}
          paying={submitting}
          payBlockedReason={payBlockedReason}
          onSelect={(id) => {
            setSelectedId(id);
            if (pendingRemoveId !== id) setPendingRemoveId(null);
          }}
          onQtyChange={changeQty}
          onRequestRemove={requestRemove}
          onDiscountChange={(id, patch) => usePosStore.getState().setLineDiscount(id, patch)}
          onInvoiceDiscountChange={(amount) => usePosStore.getState().setInvoiceDiscount(amount)}
          onSerialChange={(id, value, status) => usePosStore.getState().setSerial(id, value, status)}
          onCustomerClick={() => (perms.customerView || perms.customerCreate) && setDialog('customer')}
          onClearCustomer={() => usePosStore.getState().setCustomer(null)}
          onPay={openPay}
        />
      </div>

      <CashierBottomBar
        online={online}
        pcIdentifier={pcIdentifier}
        canHold
        canViewInvoices={perms.invoiceView}
        canStock={perms.productView}
        canReturn={perms.returns}
        holding={holding}
        onHold={() => holdSale()}
        onResume={() => setDialog('held')}
        onInvoices={() => setDialog('invoices')}
        onStock={() => setDialog('stock')}
        onReturn={() => router.push('/returns/new')}
        onExit={requestExit}
      />

      <CashierPaymentDialog
        open={dialog === 'pay'}
        total={totals.total}
        customer={selectedCustomer}
        payments={payments}
        submitting={submitting}
        error={payError}
        onAdd={(method, amount) => usePosStore.getState().addPayment(method, amount)}
        onUpdate={(id, patch) => usePosStore.getState().updatePayment(id, patch)}
        onRemove={(id) => usePosStore.getState().removePayment(id)}
        onCancel={closeDialog}
        onConfirm={confirmPay}
      />

      <CashierSuccessDialog
        sale={completed}
        onNewSale={() => {
          setCompleted(null);
          setTimeout(() => focusSearch(), 0);
        }}
      />

      <CashierCustomerDialog
        open={dialog === 'customer' || dialog === 'customerCreate'}
        startInCreate={dialog === 'customerCreate'}
        canSearch={perms.customerView}
        canCreate={perms.customerCreate}
        canViewBalance={perms.viewBalance}
        onClose={closeDialog}
        onSelect={(c) => {
          usePosStore.getState().setCustomer(c);
          if (c) toast.success(`Customer: ${c.name}`);
        }}
      />

      <CashierQuickActionsDialog open={dialog === 'quick'} actions={quickActions} onClose={() => setDialog(null)} />

      <CashierHeldSalesDialog
        open={dialog === 'held'}
        userId={userId}
        currentDraftId={draftInvoiceId}
        resumingId={resumingId}
        onClose={closeDialog}
        onResume={resumeSale}
      />
      <CashierInvoicesDialog open={dialog === 'invoices'} onClose={closeDialog} />
      <CashierStockDialog open={dialog === 'stock'} onClose={closeDialog} />

      {perms.productCreate && (
        <QuickAddProductModal
          open={dialog === 'product'}
          initialBarcode={unknownCode || ''}
          categoryRequired={false}
          onClose={() => {
            setUnknownCode(null);
            closeDialog();
          }}
          onRefreshProducts={() => {
            codeCache.current.clear();
            fetchProductsRef.current();
          }}
          onAddToCart={(v) => addVariant(v)}
        />
      )}
      {perms.customItem && (
        <AddCustomItemModal
          open={dialog === 'custom'}
          onClose={closeDialog}
          onAdd={(item) => {
            usePosStore.getState().addCustomItem(item);
            setLastScan({ tone: 'ok', text: `Added ${item.description}` });
          }}
        />
      )}

      <CashierExitDialog
        open={dialog === 'exit'}
        canHold
        holding={holding}
        onKeep={leave}
        onHold={async () => {
          if (await holdSale()) leave();
        }}
        onDiscard={() => {
          usePosStore.getState().clearCart();
          clearSaleBackup();
          leave();
        }}
        onCancel={closeDialog}
      />

      <span className="sr-only" aria-live="polite">
        {lines.length ? `Total ${formatCurrency(totals.total)}` : ''}
      </span>
    </div>
  );
}
