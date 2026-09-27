// Payload for a simple (single-variant, sold-by-piece) product — the shape
// POST /products expects. Shared by POS quick-add and the mobile add flow so
// there is one definition of "minimal product"; SKU and internal barcode are
// generated server-side.

export interface QuickProductInput {
  name: string;
  categoryId: string | number | null;
  sellingPrice: number;
  openingStock: number;
  barcode?: string | null;
  costPrice?: number;
}

export function buildSimpleProductPayload(input: QuickProductInput) {
  return {
    name: input.name.trim(),
    categoryId: input.categoryId || null,
    hasVariants: false,
    soldBy: 'piece',
    unitLabel: 'pcs',
    isActive: true,
    simple: {
      sellingPrice: input.sellingPrice,
      ...(input.costPrice !== undefined ? { costPrice: input.costPrice } : {}),
      openingStock: input.openingStock,
      barcode: input.barcode?.trim() || null,
      sku: null,
      supplierBarcode: null,
    },
  };
}

export function isDuplicateBarcodeError(err: any) {
  if (err?.status !== 409) return false;
  return err?.details?.field === 'barcode' || err?.field === 'barcode' || /barcode/i.test(err?.message || '');
}
