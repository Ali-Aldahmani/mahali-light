// Shared supplier shape used across the suppliers list, profile, and form.
// The API returns camelCase fields; this intentionally does not reuse the
// generic `Supplier` stub in `@/types` (snake_case, minimal) since it does
// not match what these screens actually render.
export interface Supplier {
  id: number;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  paymentTerms?: string | null;
  defaultLeadTimeDays?: number | null;
  notes?: string | null;
  isActive?: boolean;
  totalSpent?: number;
  outstandingBalance?: number;
  lastOrderDate?: string | null;
  lastPaymentDate?: string | null;
  avgLeadTimeDays?: number | null;
  defectRate?: number | null;
  overdueCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SupplierListTotals {
  totalSuppliers?: number;
  totalOutstanding?: number;
  overdueCount?: number;
}

export interface SupplierListMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  totals?: SupplierListTotals;
}
