// Shared purchase-order shapes used across the PO list, detail, new-PO
// wizard, and the receive/payment/return slide-overs. Intentionally not
// reusing the generic `PurchaseOrder` stub in `@/types` (snake_case,
// minimal) since it does not match the real API shape these screens render.

export interface POItem {
  id?: number;
  productId: number;
  variantId: number;
  productName: string;
  productImage?: string | null;
  sku?: string;
  barcode?: string | null;
  unitLabel?: string | null;
  quantity: number | string;
  quantityReceived?: number;
  quantityRemaining?: number;
  costPricePerUnit: number | string;
  totalCost?: number;
}

export interface PurchaseOrder {
  id: number;
  poNumber: string;
  supplierId: number;
  supplierName?: string;
  orderDate: string;
  expectedDate?: string | null;
  dueDate?: string | null;
  receivedDate?: string | null;
  taxAmount?: number;
  subtotal?: number;
  totalCost?: number;
  amountPaid?: number;
  balanceDue?: number;
  paymentStatus?: string;
  status: string;
  notes?: string | null;
  attachmentPath?: string | null;
  updatedAt?: string;
  itemsCount?: number;
  items?: POItem[];
}

export interface PurchaseOrderTotals {
  totalPos?: number;
  pendingPayment?: number;
  overdueAmount?: number;
  overdueCount?: number;
  thisMonthSpent?: number;
}

export interface PurchaseOrderListMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  totals?: PurchaseOrderTotals;
}

export interface Payment {
  id: number;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  notes?: string | null;
  poId?: number;
  poNumber?: string;
  employeeUsername?: string;
  receiptAttachment?: string | null;
}

// Shape returned by VariantSearchInput's onSelect / searchProducts results.
export interface VariantSearchResult {
  productId: number;
  variantId: number;
  productName: string;
  imagePath?: string | null;
  productImage?: string | null;
  sku?: string;
  barcode?: string | null;
  internalBarcode?: string | null;
  unitLabel?: string | null;
  costPrice?: number | null;
  stockQty?: number;
}
