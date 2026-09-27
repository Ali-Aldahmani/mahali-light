import {
  createInvoice,
  updateInvoiceItems,
  addInvoicePayment,
  confirmInvoice,
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
  const created: any = await createInvoice({ ...body, pcIdentifier: draft.pcIdentifier });
  return { id: created.id as string, invoiceNumber: created.invoiceNumber ?? null };
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
}) {
  const saved = await saveDraft(draft, draftInvoiceId);
  onDraftSaved?.(saved.id, saved.invoiceNumber);
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
      return 'Connection problem — the sale was not completed. Your cart is kept; try again.';
    default:
      return err?.message || 'Could not confirm invoice.';
  }
}
