import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  Loader2,
  Package,
  Search,
  ShoppingCart,
  Tag,
  X,
} from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import CustomerSelect from '../../components/ui/CustomerSelect.jsx';
import InvoiceTotalsBlock from '../../components/ui/InvoiceTotalsBlock.jsx';
import SplitPaymentBuilder from '../../components/ui/SplitPaymentBuilder.jsx';
import POSProductCard from '../../components/pos/POSProductCard.jsx';
import POSVariantSelector from '../../components/pos/POSVariantSelector.jsx';
import CartItem from '../../components/pos/CartItem.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { useBarcodeListener } from '../../hooks/useBarcodeListener.js';
import { usePosStore } from '../../store/posStore.js';
import { useInvoiceStore } from '../../store/invoiceStore.js';
import { useSocketStore } from '../../store/socketStore.js';
import { onStockUpdate } from '../../store/socketStore.js';
import { toast } from '../../store/toastStore.js';
import { searchProducts } from '../../services/productService.js';
import { listCategoriesFlat } from '../../services/categoryService.js';
import {
  createInvoice,
  addInvoicePayment,
  confirmInvoice as confirmInvoiceApi,
} from '../../services/invoiceService.js';
import { formatCurrency } from '../../utils/format.js';

export default function POSPage() {
  const cart = usePosStore((s) => s.cart);
  const selectedCustomer = usePosStore((s) => s.selectedCustomer);
  const payments = usePosStore((s) => s.payments);
  const invoiceDiscount = usePosStore((s) => s.invoiceDiscount);
  const pcIdentifier = usePosStore((s) => s.pcIdentifier);
  const isOffline = usePosStore((s) => s.isOffline);

  const setCustomer = usePosStore((s) => s.setCustomer);
  const addToCart = usePosStore((s) => s.addToCart);
  const updateQty = usePosStore((s) => s.updateQty);
  const setLineDiscount = usePosStore((s) => s.setLineDiscount);
  const removeFromCart = usePosStore((s) => s.removeFromCart);
  const setInvoiceDiscount = usePosStore((s) => s.setInvoiceDiscount);
  const addPayment = usePosStore((s) => s.addPayment);
  const updatePayment = usePosStore((s) => s.updatePayment);
  const removePayment = usePosStore((s) => s.removePayment);
  const clearCart = usePosStore((s) => s.clearCart);

  const totals = usePosStore((s) => s.calculateTotals());

  const refreshInvoiceSummary = useInvoiceStore((s) => s.refreshSummary);

  // Server connectivity → offline flag.
  const isConnected = useSocketStore((s) => s.isConnected);
  useEffect(() => {
    usePosStore.getState().setOffline(!isConnected);
  }, [isConnected]);

  // ---- Product browser state -------------------------------------------
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const fetchSeq = useRef(0);

  // ---- Variant selector ------------------------------------------------
  const [variantSelector, setVariantSelector] = useState(null);

  // ---- Confirm modal + success ----------------------------------------
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);

  // Fetch categories once.
  useEffect(() => {
    listCategoriesFlat()
      .then((rows) => setCategories(rows || []))
      .catch(() => {});
  }, []);

  // Fetch products (search + category).
  async function fetchProducts() {
    const seq = ++fetchSeq.current;
    setLoading(true);
    try {
      const data = await searchProducts(debouncedSearch.trim(), 60, {
        categoryId: activeCategoryId || undefined,
      });
      if (seq !== fetchSeq.current) return;
      setProducts(data || []);
    } catch (_e) {
      if (seq === fetchSeq.current) setProducts([]);
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }

  useEffect(() => {
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, activeCategoryId]);

  // Refresh stock when a stock_updated event fires elsewhere (rare on POS).
  useEffect(() => {
    let throttle = null;
    return onStockUpdate(() => {
      if (throttle) return;
      throttle = setTimeout(() => {
        throttle = null;
        fetchProducts();
      }, 800);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Barcode scanner integration. On scan, look up the code via the search
  // endpoint and add the first match directly. We also clear the manual
  // search box so the cashier isn't surprised by an unrelated typed query.
  const onScan = useCallback(async (code) => {
    if (!code) return;
    setSearch('');
    try {
      const matches = await searchProducts(code, 5);
      const exact =
        (matches || []).find(
          (v) =>
            v.barcode === code ||
            v.internalBarcode === code ||
            v.supplierBarcode === code ||
            v.sku === code,
        ) || matches?.[0];
      if (!exact) {
        toast.warning(`No product found for barcode ${code}.`);
        return;
      }
      if (Number(exact.stockQty || 0) <= 0) {
        toast.error(`${exact.productName} is out of stock.`);
        return;
      }
      addToCart(exact, 1);
      toast.success(`Added ${exact.productName} to cart.`);
    } catch (_e) {
      toast.error('Could not look up scanned code.');
    }
  }, [addToCart]);

  useBarcodeListener(onScan, { enabled: !confirmOpen && !success });

  function handleProductClick(variant) {
    const siblings = products.filter(
      (v) => v.productId === variant.productId,
    );
    if (siblings.length <= 1 && (!variant.attributes || variant.attributes.length === 0)) {
      addToCart(variant, 1);
      return;
    }
    setVariantSelector(variant);
  }

  // ---- Submission ------------------------------------------------------
  async function submitInvoice() {
    if (!totals.items.length) return;
    if (Math.abs(totals.balanceDue) > 0.001 && totals.balanceDue > 0) {
      // The cashier explicitly left a balance → goes onto customer credit
      // if a registered customer is selected, otherwise block.
      if (!selectedCustomer) {
        toast.error('Cannot leave a balance for a guest customer.');
        return;
      }
    }
    setSubmitting(true);
    try {
      const created = await createInvoice({
        customerId: selectedCustomer?.id || null,
        pcIdentifier,
        notes: usePosStore.getState().notes || null,
        invoiceDiscount,
        items: totals.items.map((it) => ({
          variantId: it.variantId,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          discountAmount: Number(it.lineDiscount || 0),
        })),
      });
      const invoiceId = created.id;

      for (const pm of payments) {
        if (!pm.amount || Number(pm.amount) <= 0) continue;
        await addInvoicePayment(invoiceId, {
          method: pm.method,
          amount: Number(pm.amount),
        });
      }

      const confirmed = await confirmInvoiceApi(invoiceId);

      setSuccess({
        invoiceId,
        invoiceNumber: confirmed.invoice.invoiceNumber,
        total: confirmed.invoice.total,
        amountPaid: confirmed.invoice.amountPaid,
        balanceDue: confirmed.invoice.balanceDue,
        customerName: selectedCustomer?.name || null,
      });
      setConfirmOpen(false);
      clearCart();
      refreshInvoiceSummary?.();
    } catch (err) {
      if (err?.code === 'BIZ_INSUFFICIENT_STOCK') {
        toast.error(err.message || 'Some items no longer have enough stock.');
      } else if (err?.code === 'BIZ_GUEST_NO_CREDIT') {
        toast.error('Credit payments require a registered customer.');
      } else if (err?.code === 'BIZ_CREDIT_LIMIT_EXCEEDED') {
        toast.error(err.message || 'Sale would exceed the customer credit limit.');
      } else {
        toast.error(err?.message || 'Could not confirm invoice.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Layout ----------------------------------------------------------
  return (
    <div className="-mx-8 -my-6 h-[calc(100vh-3.5rem)] flex">
      <ProductBrowser
        search={search}
        onSearchChange={setSearch}
        loading={loading}
        products={products}
        categories={categories}
        activeCategoryId={activeCategoryId}
        onCategoryChange={setActiveCategoryId}
        onProductClick={handleProductClick}
        isOffline={isOffline}
      />

      <CartPanel
        cart={cart}
        totals={totals}
        invoiceDiscount={invoiceDiscount}
        selectedCustomer={selectedCustomer}
        onCustomerChange={setCustomer}
        onQtyChange={updateQty}
        onDiscountChange={setLineDiscount}
        onRemove={removeFromCart}
        onInvoiceDiscountChange={setInvoiceDiscount}
        onClearCart={clearCart}
        onConfirmPay={() => setConfirmOpen(true)}
      />

      <POSVariantSelector
        open={!!variantSelector}
        onClose={() => setVariantSelector(null)}
        variant={variantSelector}
        siblings={products}
        onAdd={(v, qty) => addToCart(v, qty)}
      />

      {confirmOpen && (
        <ConfirmPayModal
          totals={totals}
          customer={selectedCustomer}
          payments={payments}
          onAddPayment={(method, amount) => addPayment(method, amount)}
          onUpdatePayment={updatePayment}
          onRemovePayment={removePayment}
          submitting={submitting}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={submitInvoice}
        />
      )}

      {success && (
        <SuccessScreen
          success={success}
          onNewSale={() => setSuccess(null)}
        />
      )}
    </div>
  );
}

// ============== Product browser =========================================

function ProductBrowser({
  search,
  onSearchChange,
  loading,
  products,
  categories,
  activeCategoryId,
  onCategoryChange,
  onProductClick,
  isOffline,
}) {
  const visibleCats = useMemo(
    () => categories.filter((c) => !c.parentId || c.parentId === null),
    [categories],
  );

  return (
    <div className="flex-1 min-w-0 flex flex-col border-r border-border bg-bg">
      <div className="px-6 pt-5 pb-3 space-y-3 border-b border-border bg-surface">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Input
              autoFocus
              placeholder="Search by name, SKU, barcode, or attribute…"
              leftIcon={<Search className="h-4 w-4" />}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          {isOffline && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-warning-light text-warning text-xs font-medium">
              <span className="h-2 w-2 rounded-full bg-warning" />
              Offline mode
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 pb-1">
          <CategoryPill
            label="All"
            active={!activeCategoryId}
            onClick={() => onCategoryChange(null)}
          />
          {visibleCats.map((c) => (
            <CategoryPill
              key={c.id}
              label={c.name}
              active={activeCategoryId === c.id}
              onClick={() => onCategoryChange(c.id)}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-card border border-dashed border-border bg-surface-2 p-10 text-center">
            <Package className="h-8 w-8 mx-auto text-ink-muted" />
            <div className="text-sm text-ink-muted mt-2">
              No products found. Try a different search or scan a barcode.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3">
            {products.map((v) => (
              <POSProductCard
                key={v.variantId}
                variant={v}
                onClick={onProductClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryPill({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border whitespace-nowrap transition',
        active
          ? 'bg-accent-light text-accent border-accent'
          : 'bg-surface text-ink border-border hover:bg-surface-2',
      ].join(' ')}
    >
      <Tag className="h-3 w-3" />
      {label}
    </button>
  );
}

// ============== Cart panel ==============================================

function CartPanel({
  cart,
  totals,
  invoiceDiscount,
  selectedCustomer,
  onCustomerChange,
  onQtyChange,
  onDiscountChange,
  onRemove,
  onInvoiceDiscountChange,
  onClearCart,
  onConfirmPay,
}) {
  return (
    <div className="w-[400px] shrink-0 bg-surface flex flex-col">
      <div className="px-4 pt-4 pb-3 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-ink font-semibold">
            <ShoppingCart className="h-4 w-4" />
            Order
          </div>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={onClearCart}
              className="text-xs text-ink-muted hover:text-error inline-flex items-center gap-1"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
        <CustomerSelect
          label={null}
          value={selectedCustomer}
          onChange={onCustomerChange}
          placeholder="Search customer by name or phone"
          showBalance
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {cart.length === 0 ? (
          <div className="rounded-card border border-dashed border-border bg-surface-2 p-6 text-center">
            <ShoppingCart className="h-7 w-7 mx-auto text-ink-muted" />
            <div className="text-sm text-ink-muted mt-2">
              Cart is empty — add products from the grid or scan a barcode.
            </div>
          </div>
        ) : (
          cart.map((it) => (
            <CartItem
              key={it.variantId}
              item={it}
              onQtyChange={(q) => onQtyChange(it.variantId, q)}
              onDiscountChange={(d) => onDiscountChange(it.variantId, d)}
              onRemove={() => onRemove(it.variantId)}
            />
          ))
        )}
      </div>

      <div className="border-t border-border px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">Invoice discount (AED)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={invoiceDiscount || ''}
            onChange={(e) => onInvoiceDiscountChange(e.target.value)}
            placeholder="0.00"
            className="ml-auto h-7 w-24 text-xs text-ink text-right px-2 rounded-input border border-border bg-surface outline-none"
          />
        </div>
        <InvoiceTotalsBlock
          subtotal={totals.subtotal}
          discount={totals.discount}
          taxable={totals.taxable}
          taxRate={totals.taxRate}
          tax={totals.tax}
          total={totals.total}
          size="md"
        />
        <Button
          className="w-full"
          size="lg"
          onClick={onConfirmPay}
          disabled={cart.length === 0}
          leftIcon={<Banknote className="h-4 w-4" />}
        >
          Confirm &amp; Pay · {formatCurrency(totals.total)}
        </Button>
      </div>
    </div>
  );
}

// ============== Confirm pay modal =======================================

function ConfirmPayModal({
  totals,
  customer,
  payments,
  onAddPayment,
  onUpdatePayment,
  onRemovePayment,
  submitting,
  onCancel,
  onConfirm,
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-card bg-surface border border-border shadow-pop overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-ink">Confirm sale</div>
            <div className="text-xs text-ink-muted">
              {customer ? customer.name : 'Guest customer'} ·{' '}
              {totals.items.length} item(s)
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
          <div className="p-4 border-b md:border-b-0 md:border-r border-border max-h-[60vh] overflow-y-auto">
            <div className="text-xs font-medium text-ink-muted mb-2">
              Order summary
            </div>
            <ul className="space-y-1.5">
              {totals.items.map((it) => (
                <li
                  key={it.variantId}
                  className="flex items-start justify-between gap-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="text-ink truncate">{it.productName}</div>
                    <div className="text-xs text-ink-muted">
                      {it.quantity} × {formatCurrency(it.unitPrice)}
                      {Number(it.lineDiscount || 0) > 0 && (
                        <> · -{formatCurrency(it.lineDiscount)}</>
                      )}
                    </div>
                  </div>
                  <div className="text-ink font-medium shrink-0">
                    {formatCurrency(it.lineTotal)}
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-border mt-4 pt-3">
              <InvoiceTotalsBlock
                subtotal={totals.subtotal}
                discount={totals.discount}
                taxable={totals.taxable}
                taxRate={totals.taxRate}
                tax={totals.tax}
                total={totals.total}
                amountPaid={totals.amountPaid}
                balanceDue={totals.balanceDue}
                showPayments
              />
            </div>
          </div>

          <div className="p-4 space-y-3">
            <div className="text-xs font-medium text-ink-muted">Payments</div>
            <SplitPaymentBuilder
              payments={payments}
              total={totals.total}
              customerLinked={!!customer}
              onAdd={onAddPayment}
              onUpdate={onUpdatePayment}
              onRemove={onRemovePayment}
            />
          </div>
        </div>

        <div className="p-4 border-t border-border flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            loading={submitting}
            disabled={!totals.items.length}
          >
            Confirm invoice
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============== Success screen ==========================================

function SuccessScreen({ success, onNewSale }) {
  const [seconds, setSeconds] = useState(5);
  useEffect(() => {
    if (seconds <= 0) {
      onNewSale();
      return undefined;
    }
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds, onNewSale]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-card bg-surface border border-border shadow-pop overflow-hidden">
        <div className="p-6 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-success-light text-success inline-flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <div className="mt-3 text-base font-semibold text-ink">
            Sale recorded
          </div>
          <div className="mt-1 text-sm text-ink-muted">
            {success.customerName || 'Guest customer'}
          </div>
          <div className="mt-4 font-mono text-lg text-accent">
            {success.invoiceNumber}
          </div>
          <div className="mt-3 text-3xl font-semibold text-ink">
            {formatCurrency(success.total)}
          </div>
          <div className="mt-1 text-xs text-ink-muted">
            Paid {formatCurrency(success.amountPaid)} ·{' '}
            {success.balanceDue > 0
              ? `Balance ${formatCurrency(success.balanceDue)} on credit`
              : 'Fully paid'}
          </div>

          <div className="mt-6 flex items-center justify-center gap-2">
            <Button variant="secondary" disabled>
              Print (Phase 7)
            </Button>
            <Button onClick={onNewSale}>New sale ({seconds})</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
