// Shared shapes for the returns feature (requests, orders and their line
// items). Mirrors the fields the Express API actually returns (see
// src/pages/returns/*.jsx and src/services/return*Service.js on the
// reference SPA). Scoped to this route group since web/types/ and
// web/components/returns/ are shared foundation this pass must not touch.

export interface SelectOption {
  value: string;
  label: string;
}

export interface ReturnItem {
  id: string;
  invoiceItemId?: string | null;
  productId?: string | null;
  variantId?: string | null;
  productName: string;
  sku?: string | null;
  unitLabel?: string | null;
  unitPrice: number;
  quantity: number;
  condition?: 'good' | 'defective' | 'damaged' | string;
  serialNumber?: string | null;
  totalValue?: number;
  stockAction?: 'returned_to_stock' | 'quarantined' | 'disposed' | string;
}

export interface RefundPlanEntry {
  method: 'cash' | 'bank' | 'credit' | string;
  amount: number;
  notes?: string | null;
}

export interface ReplacementPlanItem {
  id?: string;
  variantId?: string | null;
  productId?: string | null;
  productName: string;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
}

export interface ReplacementPlan {
  items: ReplacementPlanItem[];
  priceDifference?: number;
  differenceDirection?: 'customer_pays' | 'refund_to_customer' | 'none' | string;
}

export interface ReturnHistoryEntry {
  id: string;
  action: string;
  timestamp: string;
  performedByUsername?: string | null;
  notes?: string | null;
}

export interface ReturnOrderSummary {
  id: string;
  returnOrderNumber: string;
  createdAt?: string | null;
  refundTotal?: number;
  replacementInvoiceId?: string | null;
}

export interface ReturnRequest {
  id: string;
  requestNumber: string;
  returnType: 'customer_refund' | 'customer_replace' | 'supplier_return' | string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | string;
  reason?: string | null;
  requestNote?: string | null;
  rejectionReason?: string | null;
  noInvoiceReturn?: boolean;
  totalValue?: number;
  itemCount?: number;
  referenceId?: string | null;
  invoiceNumber?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  requestedBy?: string | null;
  requestedByUsername?: string | null;
  requestedAt?: string | null;
  approvedByUsername?: string | null;
  reviewedByUsername?: string | null;
  reviewedAt?: string | null;
  items?: ReturnItem[];
  refundPlan?: RefundPlanEntry[] | null;
  replacementPlan?: ReplacementPlan | null;
  history?: ReturnHistoryEntry[];
  order?: ReturnOrderSummary | null;
}

export interface ReturnOrder {
  id: string;
  returnOrderNumber: string;
  returnType: 'customer_refund' | 'customer_replace' | 'supplier_return' | string;
  status: string;
  totalValue?: number;
  refundTotal?: number;
  customerId?: string | null;
  customerName?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  originalInvoiceId?: string | null;
  originalInvoiceNumber?: string | null;
  replacementInvoiceId?: string | null;
  replacementInvoiceNumber?: string | null;
  returnRequestId?: string | null;
  requestNumber?: string | null;
  employeeUsername?: string | null;
  createdAt?: string | null;
  notes?: string | null;
  items?: ReturnItem[];
  refundPayments?: RefundPlanEntry[] & { id?: string }[];
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  createdAt?: string | null;
  total: number;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  items?: InvoiceItem[];
  hasReturn?: boolean;
}

export interface InvoiceItem {
  id: string;
  productId?: string | null;
  variantId?: string | null;
  productName: string;
  sku?: string | null;
  serialNumber?: string | null;
  unitLabel?: string | null;
  unitPrice: number;
  quantity: number;
  availableQty?: number;
  committedReturnQty?: number;
}
