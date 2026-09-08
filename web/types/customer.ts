export interface Customer {
  id: number;
  name: string;
  phone?: string;
  email?: string | null;
  balance?: number;
  credit_limit?: number | null;
  is_active?: boolean;
  created_at?: string;
}

export interface Supplier {
  id: number;
  name: string;
  phone?: string;
  email?: string | null;
  balance?: number;
  is_active?: boolean;
}

export interface PurchaseOrder {
  id: number;
  po_number: string;
  supplier_id: number;
  status: string;
  total: number;
  created_at: string;
}
