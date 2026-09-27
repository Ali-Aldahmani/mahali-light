// UX-only preview of product pricing restrictions for the cart. Mirrors
// server/services/pricingRestrictionService.evaluatePriceRestrictions so the
// cashier sees the same messages before paying — the server re-checks every
// line (and the invoice discount allocation) and rejects violations with 422.
// Never render these limits on a customer-facing display.

export interface PricingRestrictionLike {
  minPrice?: number | null;
  maxDiscountPercent?: number | null;
  maxDiscountAmount?: number | null;
}

export interface PriceViolation {
  restrictionType: 'MINIMUM_PRICE' | 'MAX_DISCOUNT_PERCENT' | 'MAX_DISCOUNT_AMOUNT';
  limit: number;
  attempted: number;
  message: string;
}

function money(n: unknown): number {
  const v = Number(n) || 0;
  return v < 0 ? -Math.round(-v * 100 + 1e-9) / 100 : Math.round(v * 100 + 1e-9) / 100;
}

export function evaluatePriceRestrictions({
  restriction,
  catalogPrice,
  netUnitPrice,
}: {
  restriction: PricingRestrictionLike | null | undefined;
  catalogPrice: number;
  netUnitPrice: number;
}): PriceViolation[] {
  if (!restriction) return [];
  const catalog = money(catalogPrice);
  const net = money(netUnitPrice);
  const discountPerUnit = money(catalog - net);
  const out: PriceViolation[] = [];

  if (restriction.minPrice != null) {
    const min = Number(restriction.minPrice);
    if (net < min - 0.005) {
      out.push({
        restrictionType: 'MINIMUM_PRICE',
        limit: min,
        attempted: net,
        message: `Minimum selling price is AED ${min.toFixed(2)}.`,
      });
    }
  }
  if (restriction.maxDiscountPercent != null) {
    const max = Number(restriction.maxDiscountPercent);
    const pct = catalog > 0 ? (discountPerUnit / catalog) * 100 : 0;
    if (discountPerUnit > 0.005 && pct > max + 0.01) {
      out.push({
        restrictionType: 'MAX_DISCOUNT_PERCENT',
        limit: max,
        attempted: money(pct),
        message: `Maximum allowed discount is ${max}%.`,
      });
    }
  }
  if (restriction.maxDiscountAmount != null) {
    const max = Number(restriction.maxDiscountAmount);
    if (discountPerUnit > max + 0.005) {
      out.push({
        restrictionType: 'MAX_DISCOUNT_AMOUNT',
        limit: max,
        attempted: discountPerUnit,
        message: `Maximum allowed discount amount is AED ${max.toFixed(2)}.`,
      });
    }
  }
  return out;
}

// Per-line check using the totals-computed line (lineTotal already includes
// the line discount). The catalog price is the unit price the server gave us.
export function lineViolations(line: any): PriceViolation[] {
  if (!line || line.isCustom || !line.pricingRestriction) return [];
  const qty = Number(line.quantity);
  if (!(qty > 0)) return [];
  return evaluatePriceRestrictions({
    restriction: line.pricingRestriction,
    catalogPrice: Number(line.unitPrice),
    netUnitPrice: Number(line.lineTotal) / qty,
  });
}

// Invoice-level discount spread across lines by line total — same rule the
// server applies in assertInvoiceDiscountAllowed.
export function cartViolations(
  lines: any[],
  invoiceDiscount = 0,
): Map<string | number, PriceViolation[]> {
  const result = new Map<string | number, PriceViolation[]>();
  const base = lines.reduce((s, l) => s + Number(l.lineTotal || 0), 0);
  const inv = Number(invoiceDiscount) || 0;
  for (const line of lines) {
    let v = lineViolations(line);
    if (!v.length && inv > 0 && base > 0 && line.pricingRestriction && !line.isCustom) {
      const qty = Number(line.quantity);
      if (qty > 0) {
        const share = (inv * Number(line.lineTotal || 0)) / base;
        v = evaluatePriceRestrictions({
          restriction: line.pricingRestriction,
          catalogPrice: Number(line.unitPrice),
          netUnitPrice: (Number(line.lineTotal || 0) - share) / qty,
        });
      }
    }
    if (v.length) result.set(line.variantId, v);
  }
  return result;
}
