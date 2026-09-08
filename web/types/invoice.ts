export interface InvoiceLineItem {
  id?: number;
  product_id: number;
  variant_id?: number | null;
  name: string;
  quantity: number;
  unit_price: number;
  discount?: number;
  tax_amount?: number;
  total: number;
}

export type InvoiceStatus = 'draft' | 'paid' | 'partially_paid' | 'void' | 'refunded' | string;

export interface Invoice {
  id: number;
  invoice_number: string;
  customer_id?: number | null;
  status: InvoiceStatus;
  subtotal: number;
  discount?: number;
  tax_amount?: number;
  total: number;
  amount_paid?: number;
  created_at: string;
  items?: InvoiceLineItem[];
}

export interface InvoiceEditRequest {
  id: number;
  invoice_id: number;
  requested_by: number;
  status: 'pending' | 'approved' | 'rejected' | string;
  reason?: string;
  created_at: string;
}
