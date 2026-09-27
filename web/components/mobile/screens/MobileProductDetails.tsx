'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { createProduct, lookupProductBarcode } from '@/services/productService';
import { listCategoriesFlat } from '@/services/categoryService';
import { buildSimpleProductPayload, isDuplicateBarcodeError } from '@/lib/products/quickCreate';
import { MOBILE_HOME } from '@/lib/mobile/routePolicy';
import { useMobileQuery } from '@/hooks/useMobileQuery';
import { useMobileAddProductStore } from '@/store/mobileAddProductStore';
import MobileFlowHeader from '../MobileFlowHeader';
import { PERMISSION_DENIED_MESSAGE } from '../MobileStates';

export const DUPLICATE_BARCODE_MESSAGE = 'This barcode is already assigned to an existing product.';
export const PRODUCT_ADDED_MESSAGE = 'Product added successfully.';

// Mirrors the server's create-product bounds so mistakes surface before a
// round-trip; Express still validates everything.
const MAX_NAME = 200;
const MAX_AMOUNT = 999999;
const PRICE_RE = /^\d+(\.\d{1,2})?$/;
const QTY_RE = /^\d+$/;

type Errors = Partial<Record<'name' | 'sellingPrice' | 'openingStock' | 'categoryId', string>>;

interface ExistingProduct {
  name: string;
  sku?: string | null;
}

function Field({
  label,
  error,
  children,
  htmlFor,
  errorId,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  htmlFor: string;
  errorId: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[12px] font-medium text-ink-muted">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {error && (
        <p id={errorId} className="mt-1 text-[12px] text-error">
          {error}
        </p>
      )}
    </div>
  );
}

const INPUT =
  'h-12 w-full rounded-[12px] border bg-white px-4 text-[16px] font-medium text-ink placeholder:font-normal placeholder:text-m-hint outline-none focus:border-m-accent disabled:opacity-60';

export default function MobileProductDetails() {
  const router = useRouter();
  const barcode = useMobileAddProductStore((s) => s.barcode);
  const source = useMobileAddProductStore((s) => s.source);
  const reset = useMobileAddProductStore((s) => s.reset);

  const [name, setName] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [openingStock, setOpeningStock] = useState('0');
  const [categoryId, setCategoryId] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<'checking' | 'clear' | 'duplicate'>('checking');
  const [existing, setExisting] = useState<ExistingProduct | null>(null);
  const [created, setCreated] = useState<{ name: string } | null>(null);
  const savingRef = useRef(false);
  const doneRef = useRef(false);
  const nameTouched = useRef(false);
  const ids = {
    name: useId(),
    price: useId(),
    qty: useId(),
    cat: useId(),
    nameErr: useId(),
    priceErr: useId(),
    qtyErr: useId(),
    catErr: useId(),
  };

  const categories = useMobileQuery(() => listCategoriesFlat(), []);

  useEffect(() => {
    if (!barcode && !doneRef.current) router.replace('/m/products/new');
  }, [barcode, created, router]);

  useEffect(() => {
    if (!barcode) return undefined;
    let alive = true;
    setLookup('checking');
    lookupProductBarcode(barcode)
      .then((res) => {
        if (!alive) return;
        if (res?.source === 'internal' && res.internal) {
          setExisting({ name: res.internal.product_name, sku: res.internal.sku });
          setLookup('duplicate');
          return;
        }
        if (res?.source === 'external' && res.external?.name && !nameTouched.current) {
          setName(res.external.name.slice(0, MAX_NAME));
        }
        setLookup('clear');
      })
      // Lookup is a convenience; the create call re-checks uniqueness.
      .catch(() => alive && setLookup('clear'));
    return () => {
      alive = false;
    };
  }, [barcode]);

  function validate(): Errors {
    const next: Errors = {};
    const n = name.trim();
    if (!n) next.name = 'Product name is required.';
    else if (n.length > MAX_NAME) next.name = `Keep the name under ${MAX_NAME} characters.`;
    if (!sellingPrice.trim()) next.sellingPrice = 'Enter the selling price.';
    else if (!PRICE_RE.test(sellingPrice.trim()) || Number(sellingPrice) > MAX_AMOUNT) {
      next.sellingPrice = 'Enter a valid price, e.g. 4.50.';
    }
    if (!QTY_RE.test(openingStock.trim()) || Number(openingStock) > MAX_AMOUNT) {
      next.openingStock = 'Enter a whole number, 0 or more.';
    }
    if (!categoryId) next.categoryId = 'Choose a category.';
    return next;
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (savingRef.current || lookup === 'duplicate' || !barcode) return;
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length) return;

    savingRef.current = true;
    setSaving(true);
    setSubmitError(null);
    try {
      const product = await createProduct(
        buildSimpleProductPayload({
          name,
          categoryId,
          sellingPrice: Number(sellingPrice),
          openingStock: Number(openingStock),
          barcode,
        }),
      );
      doneRef.current = true;
      setCreated({ name: product?.name || name.trim() });
      reset();
    } catch (err: any) {
      if (isDuplicateBarcodeError(err)) {
        setExisting(null);
        setLookup('duplicate');
      } else if (err?.status === 403) {
        setSubmitError(PERMISSION_DENIED_MESSAGE);
      } else if (err?.code === 'NETWORK_ERROR' || err?.code === 'NETWORK_TIMEOUT') {
        setSubmitError('Cannot reach the server. Your details are kept — check your connection and try again.');
      } else {
        setSubmitError(err?.message || 'Could not save the product. Please try again.');
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function cancel() {
    reset();
    router.replace(MOBILE_HOME);
  }

  function scanAnother() {
    reset();
    router.replace('/m/products/new');
  }

  if (created) {
    return (
      <section
        aria-labelledby="m-product-added"
        className="flex min-h-[60vh] flex-col items-center justify-center px-3 text-center font-m-work"
      >
        <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-success-light text-success">
          <CheckCircle2 aria-hidden className="h-9 w-9" />
        </span>
        <h1 id="m-product-added" role="status" className="mt-6 text-[22px] font-semibold text-ink">
          {PRODUCT_ADDED_MESSAGE}
        </h1>
        <p className="mt-2 text-[14px] text-ink-muted">{created.name}</p>
        <button
          type="button"
          onClick={() => router.replace('/m/products/new')}
          className="mt-10 flex h-[52px] w-full items-center justify-center rounded-[14px] bg-m-accent text-[14px] font-semibold text-white active:opacity-80"
        >
          Add another product
        </button>
        <button
          type="button"
          onClick={() => router.replace(MOBILE_HOME)}
          className="mt-3 flex h-12 w-full items-center justify-center text-[14px] font-medium text-ink-muted active:opacity-60"
        >
          Back to dashboard
        </button>
      </section>
    );
  }

  if (!barcode) return null;

  const cats: any[] = (categories.data as any[]) || [];
  const disabled = saving || lookup === 'duplicate';

  return (
    <form onSubmit={onSave} noValidate className="flex flex-col font-m-work" aria-busy={saving}>
      <MobileFlowHeader title="Product details" onBack={() => router.back()} />

      <div className="mt-6 px-3">
        {lookup === 'duplicate' ? (
          <div role="alert" className="flex gap-3 rounded-[14px] border border-error/30 bg-error-light p-4">
            <AlertCircle aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-error" />
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-error">{DUPLICATE_BARCODE_MESSAGE}</p>
              {existing && (
                <p className="mt-1 break-words text-[13px] text-ink">
                  {existing.name}
                  {existing.sku ? <span className="text-ink-muted"> · SKU {existing.sku}</span> : null}
                </p>
              )}
              <button
                type="button"
                onClick={scanAnother}
                className="mt-3 h-11 rounded-[12px] border border-m-line bg-white px-4 text-[14px] font-medium text-m-accent active:bg-m-field"
              >
                Scan another barcode
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[13px] font-medium text-success">
            {source === 'manual' ? 'Barcode entered manually' : 'Barcode scanned successfully'}
          </p>
        )}
      </div>

      <div className="mt-5 flex items-center gap-12 px-3">
        <span className="flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-[16px] bg-m-field">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mobile/product-image.svg" alt="" aria-hidden className="h-9 w-9" />
        </span>
        <div className="min-w-0">
          <p className="line-clamp-2 break-words text-[16px] font-semibold text-ink">{name.trim() || 'Product name'}</p>
          <p data-testid="details-barcode" className="mt-2 text-[13px] tracking-wide text-ink-muted">
            {barcode}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-muted">
            {lookup === 'checking' && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
            {lookup === 'checking' ? 'Checking barcode…' : 'Review the basic details before saving.'}
          </p>
        </div>
      </div>

      <div className="mt-7 space-y-3 px-3">
        <Field label="Product name" htmlFor={ids.name} error={errors.name} errorId={ids.nameErr}>
          <input
            id={ids.name}
            className={cn(INPUT, errors.name ? 'border-error' : 'border-m-line')}
            value={name}
            maxLength={MAX_NAME}
            autoComplete="off"
            enterKeyHint="next"
            placeholder="e.g. Coca-Cola Original Taste 330ml"
            onChange={(e) => {
              nameTouched.current = true;
              setName(e.target.value);
            }}
            disabled={disabled}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? ids.nameErr : undefined}
          />
        </Field>

        <Field label="Selling price" htmlFor={ids.price} error={errors.sellingPrice} errorId={ids.priceErr}>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[16px] font-medium text-ink">
              AED
            </span>
            <input
              id={ids.price}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="next"
              placeholder="0.00"
              className={cn(INPUT, 'pl-[60px]', errors.sellingPrice ? 'border-error' : 'border-m-line')}
              value={sellingPrice}
              onChange={(e) => setSellingPrice(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))}
              disabled={disabled}
              aria-invalid={!!errors.sellingPrice}
              aria-describedby={errors.sellingPrice ? ids.priceErr : undefined}
            />
          </div>
        </Field>

        <Field label="Initial quantity" htmlFor={ids.qty} error={errors.openingStock} errorId={ids.qtyErr}>
          <input
            id={ids.qty}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            enterKeyHint="next"
            className={cn(INPUT, errors.openingStock ? 'border-error' : 'border-m-line')}
            value={openingStock}
            onChange={(e) => setOpeningStock(e.target.value.replace(/\D/g, ''))}
            disabled={disabled}
            aria-invalid={!!errors.openingStock}
            aria-describedby={errors.openingStock ? ids.qtyErr : undefined}
          />
        </Field>

        <Field label="Category" htmlFor={ids.cat} error={errors.categoryId} errorId={ids.catErr}>
          <div className="relative">
          <select
            id={ids.cat}
            className={cn(
              INPUT,
              'appearance-none pr-10',
              !categoryId && 'font-normal text-m-hint',
              errors.categoryId ? 'border-error' : 'border-m-line',
            )}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={disabled || categories.loading || !!categories.error}
            aria-invalid={!!errors.categoryId}
            aria-describedby={errors.categoryId ? ids.catErr : undefined}
          >
            <option value="">{categories.loading ? 'Loading categories…' : 'Select category'}</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.path || c.name}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          </div>
        </Field>
        {categories.error && (
          <p className="text-[12px] text-error">
            Categories could not be loaded.{' '}
            <button type="button" onClick={categories.reload} className="min-h-[44px] font-medium text-m-accent underline">
              Retry
            </button>
          </p>
        )}
      </div>

      <p className="mt-5 px-3 text-center text-[12px] text-ink-muted">
        You can add advanced information later from the desktop.
      </p>

      {submitError && (
        <div role="alert" className="mx-3 mt-5 rounded-[14px] bg-error-light px-4 py-3 text-[14px] text-error">
          {submitError}
        </div>
      )}

      <button
        type="submit"
        disabled={disabled}
        className="mx-3 mt-8 flex h-[52px] items-center justify-center gap-2 rounded-[14px] bg-m-accent text-[14px] font-semibold text-white active:opacity-80 disabled:opacity-60"
      >
        {saving && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
        {saving ? 'Saving…' : 'Save product'}
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={saving}
        className="mx-3 mt-3 flex h-12 items-center justify-center text-[14px] font-medium text-ink-muted active:opacity-60"
      >
        Cancel
      </button>
    </form>
  );
}
