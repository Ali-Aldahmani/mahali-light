import {
  createInvoice,
  updateInvoiceItems,
  addInvoicePayment,
  confirmInvoice,
  getCheckoutStatus,
} from '@/services/invoiceService';

// Shared checkout for the admin POS page and Cashier Mode. The client only
// sends intent (variant, quantity, requested discount, payment split); the
// server re-prices from the catalog, enforces permissions, pricing
// restrictions, stock and credit, and computes the authoritative totals.

export interface CheckoutPayment {
  id: string;
  method: string;
  amount: number;
}

export interface CheckoutInput {
  totals: { items: any[]; total: number; balanceDue: number };
  cart: any[];
  payments: CheckoutPayment[];
  customer: { id?: string | null } | null;
}

export type CheckoutPrep =
  | { ok: true; allocations: CheckoutPayment[] }
  | { ok: false; message: string };

// Validates the payment split and turns cash tender into the retained
// amount (change is not a payment). Any remainder goes on customer credit
// for a registered customer; a guest can't leave a balance.
export function prepareCheckout({ totals, cart, payments, customer }: CheckoutInput): CheckoutPrep {
  if (!totals.items.length) return { ok: false, message: 'The cart is empty.' };
  const registered = !!customer?.id;
  const totalCents = Math.round(totals.total * 100);
  const nonCashCents = payments
    .filter((p) => p.method !== 'cash')
    .reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0);
  if (nonCashCents > totalCents) {
    return { ok: false, message: 'Bank and credit payments cannot exceed the invoice total.' };
  }
  let cashRemaining = totalCents - nonCashCents;
  const allocations = payments.map((p) => {
    if (p.method !== 'cash') return p;
    const cents = Math.min(Math.round(Number(p.amount) * 100), cashRemaining);
    cashRemaining -= cents;
    return { ...p, amount: cents / 100 };
  });
  if (cashRemaining > 0 && registered) {
    allocations.push({ id: 'remaining-customer-credit', method: 'credit', amount: cashRemaining / 100 });
  }
  if (totals.balanceDue > 0.001 && !registered) {
    return { ok: false, message: 'Cannot leave a balance for a guest customer.' };
  }
  const missingSerial = cart.find(
    (it: any) => it.requiresSerial && (!it.serialNumber || !it.serialValid),
  );
  if (missingSerial) {
    return {
      ok: false,
      message: missingSerial.serialError || `Enter a serial number for ${missingSerial.productName}.`,
    };
  }
  return { ok: true, allocations };
}

export function buildInvoiceItems(items: any[]) {
  return items.map((it: any) =>
    it.isCustom
      ? {
          isCustom: true,
          customDescription: it.productName,
          thirdPartyName: it.thirdPartyName || null,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          customCostPrice: Number(it.costPrice || 0),
          discountAmount: Number(it.lineDiscount || 0),
        }
      : {
          variantId: it.variantId,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          discountAmount: Number(it.lineDiscount || 0),
          serialNumber: it.serialNumber || null,
        },
  );
}

export interface SaleDraft {
  items: any[];
  customerId: string | null;
  invoiceDiscount: number;
  notes: string | null;
  pcIdentifier?: string | null;
  /** This sale attempt's ID (see posStore.checkoutId). */
  checkoutId?: string | null;
}

// Creates a draft, or rewrites an existing one (held / resumed sale).
export async function saveDraft(draft: SaleDraft, draftInvoiceId?: string | null) {
  const body = {
    customerId: draft.customerId,
    invoiceDiscount: draft.invoiceDiscount,
    notes: draft.notes,
    items: buildInvoiceItems(draft.items),
  };
  if (draftInvoiceId) {
    const updated: any = await updateInvoiceItems(draftInvoiceId, body);
    return { id: draftInvoiceId, invoiceNumber: updated?.invoiceNumber ?? null };
  }
  // With a checkout ID the server returns this attempt's existing invoice
  // instead of creating a second one.
  const created: any = await createInvoice({
    ...body,
    pcIdentifier: draft.pcIdentifier,
    checkoutId: draft.checkoutId || null,
  });
  return {
    id: created.id as string,
    invoiceNumber: created.invoiceNumber ?? null,
    status: (created.status as string) || 'draft',
  };
}

// The result shown after a sale, whichever way it was learned: from the
// confirmation itself, or from looking the sale up after a lost response.
type CompletedSale = { invoiceId: string; confirmed: { invoice?: any; warranties?: any[] } };

function cancelledSaleError() {
  return {
    code: 'SALE_CANCELLED',
    message: 'This sale was cancelled on the server. Clear the cart and start a new sale.',
  };
}

// Draft → payments → confirm. `onDraftSaved` lets the caller remember the
// draft so a retry after a failed payment/confirm reuses it (payments are
// idempotent by key) instead of leaving an orphan draft behind.
export async function submitSale({
  draft,
  allocations,
  draftInvoiceId = null,
  onDraftSaved,
}: {
  draft: SaleDraft;
  allocations: CheckoutPayment[];
  draftInvoiceId?: string | null;
  onDraftSaved?: (id: string, invoiceNumber: string | null) => void;
}): Promise<CompletedSale> {
  // A retry of an attempt that already reached the server: if it actually
  // went through, show that sale instead of trying to edit a confirmed one.
  if (draftInvoiceId && draft.checkoutId) {
    const known = await getCheckoutStatus(draft.checkoutId);
    if (known.status === 'confirmed' && known.invoice) {
      return { invoiceId: known.invoice.id, confirmed: { invoice: known.invoice, warranties: known.warranties } };
    }
    if (known.status === 'cancelled') throw cancelledSaleError();
  }

  const saved = await saveDraft(draft, draftInvoiceId);
  onDraftSaved?.(saved.id, saved.invoiceNumber);
  if ((saved as any).status && (saved as any).status !== 'draft') {
    const known = await getCheckoutStatus(draft.checkoutId as string);
    if (known.status === 'confirmed' && known.invoice) {
      return { invoiceId: known.invoice.id, confirmed: { invoice: known.invoice, warranties: known.warranties } };
    }
    throw cancelledSaleError();
  }
  for (const pm of allocations) {
    if (!pm.amount || Number(pm.amount) <= 0) continue;
    await addInvoicePayment(saved.id, {
      idempotencyKey: pm.id,
      method: pm.method,
      amount: Number(pm.amount),
    });
  }
  const confirmed = await confirmInvoice(saved.id);
  return { invoiceId: saved.id, confirmed };
}

// A dropped connection or a timeout says nothing about whether the sale went
// through — the server may have confirmed it just before the answer was lost.
export function isConnectionError(err: any): boolean {
  return err?.code === 'NETWORK_ERROR' || err?.code === 'NETWORK_TIMEOUT';
}

export type SaleOutcome =
  | ({ kind: 'completed' } & CompletedSale)
  | { kind: 'not_completed' }
  | { kind: 'unknown' };

// After a connection error: asks the server what became of this sale
// attempt, a few times in case the connection is still coming back.
export async function resolveSaleOutcome(
  checkoutId: string,
  { attempts = 3, delayMs = 1500, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)) } = {},
): Promise<SaleOutcome> {
  for (let i = 0; i < attempts; i++) {
    try {
      const known = await getCheckoutStatus(checkoutId);
      if (known.status === 'confirmed' && known.invoice) {
        return {
          kind: 'completed',
          invoiceId: known.invoice.id,
          confirmed: { invoice: known.invoice, warranties: known.warranties },
        };
      }
      return { kind: 'not_completed' };
    } catch (err) {
      if (!isConnectionError(err)) return { kind: 'unknown' };
      if (i < attempts - 1) await sleep(delayMs);
    }
  }
  return { kind: 'unknown' };
}

export const SALE_CHECKING_MESSAGE = 'Connection problem — checking whether the sale went through…';
export const SALE_NOT_COMPLETED_MESSAGE = 'The sale was not completed. Your cart is kept — you can try again.';
export const SALE_UNKNOWN_MESSAGE =
  "Couldn't reach the server to check. The sale may have gone through — don't start it again. " +
  'Press Complete sale to check again; it will not charge twice.';

export function checkoutErrorMessage(err: any): string {
  switch (err?.code) {
    case 'BIZ_INSUFFICIENT_STOCK':
      return err.message || 'Some items no longer have enough stock.';
    case 'BIZ_GUEST_NO_CREDIT':
      return 'Credit payments require a registered customer.';
    case 'BIZ_CREDIT_LIMIT_EXCEEDED':
      return err.message || 'Sale would exceed the customer credit limit.';
    case 'BIZ_PRICING_RESTRICTION_VIOLATION':
      return err.message || 'A price or discount is not allowed for one of the products.';
    case 'AUTH_NO_PERMISSION':
      return err.message || 'You do not have permission for this action.';
    case 'NETWORK_ERROR':
    case 'NETWORK_TIMEOUT':
      // Never "not completed": the server may have confirmed the sale.
      return SALE_CHECKING_MESSAGE;
    default:
      return err?.message || 'Could not confirm invoice.';
  }
}
