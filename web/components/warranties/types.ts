// Shared shapes for the warranties + warranty-claims feature. Mirrors the
// fields the Express API actually returns (see src/pages/warranties/*.jsx).

export interface SupplierWarrantySummary {
  id: string;
  warrantyNumber: string;
  supplierName?: string | null;
  endDate?: string | null;
  status?: string;
  expiringSoon?: boolean;
}

export interface WarrantyClaimSummary {
  id: string;
  claimNumber: string;
  claimDate?: string | null;
  issueDescription?: string | null;
  resolution?: string | null;
  status: string;
}

export interface Warranty {
  id: string;
  warrantyNumber: string;
  productId?: string | null;
  productName?: string | null;
  variantSku?: string | null;
  serialNumber?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  warrantyType?: 'customer' | 'supplier' | string;
  startDate?: string | null;
  endDate?: string | null;
  durationMonths?: number;
  daysRemaining?: number | null;
  status: 'active' | 'expired' | 'claimed' | 'void' | string;
  expiringSoon?: boolean;
  terms?: string | null;
  createdAt?: string | null;
  createdByUsername?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  supplierWarranty?: SupplierWarrantySummary | null;
  claims?: WarrantyClaimSummary[];
}

export interface WarrantyClaim {
  id: string;
  claimNumber: string;
  warrantyId: string;
  warrantyNumber?: string;
  productId?: string | null;
  productName?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  claimDate?: string | null;
  issueDescription?: string | null;
  notes?: string | null;
  resolution?: 'replaced' | 'repaired' | 'rejected' | null;
  status: 'open' | 'in_progress' | 'resolved' | 'rejected' | string;
  resolvedDate?: string | null;
  resolvedByUsername?: string | null;
  replacementInvoiceId?: string | null;
  replacementInvoiceNumber?: string | null;
  supplierClaimRaised?: boolean;
  supplierClaimResolved?: boolean;
  createdAt?: string | null;
  createdByUsername?: string | null;
}

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}
